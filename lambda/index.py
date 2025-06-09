# lambda/index.py
import json
import os
import boto3
import re  # 正規表現モジュールをインポート
from botocore.exceptions import ClientError
import uuid
# import requests  # OpenAI用は不要


# Lambda コンテキストからリージョンを抽出する関数
def extract_region_from_arn(arn):
    # ARN 形式: arn:aws:lambda:region:account-id:function:function-name
    match = re.search('arn:aws:lambda:([^:]+):', arn)
    if match:
        return match.group(1)
    return "us-east-1"  # デフォルト値

# グローバル変数としてクライアントを初期化（初期値）
bedrock_client = None

# モデルID
MODEL_ID = os.environ.get("MODEL_ID", "us.amazon.nova-lite-v1:0")


def ai_priority_decision(requester_details, existing_details):
    """
    Bedrock Nova Liteを使って優先度判定を行う。
    """
    prompt = f"""
    あなたはGPUサーバーの管理者です。以下の2つの予約リクエストのうち、どちらを優先すべきかを判定してください。
    1. 既存予約: {existing_details}
    2. 新規リクエスト: {requester_details}
    どちらがより重要か、1か2で答えてください。
    """
    bedrock = boto3.client('bedrock-runtime')
    body = {
        "input": prompt
    }
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps(body),
        contentType="application/json"
    )
    result = json.loads(response['body'].read())
    print("Bedrock response:", result)
    answer = result['output']['message']['content'][0]['text']
    if '2' in answer:
        return 'new'
    else:
        return 'existing'

def extract_params_from_nlp(nlp_text):
    """
    Bedrock Nova Liteで自然言語から予約パラメータを抽出
    """
    prompt = f"""
次の日本語の予約リクエストから、予約開始時刻（ISO8601）、終了時刻（ISO8601）、GPU種別（A/B/Cなど）を抽出し、以下のJSON形式で出力してください。

入力: {nlp_text}

出力例:
{{
  "startTime": "2025-06-09T14:00:00+09:00",
  "endTime": "2025-06-09T18:00:00+09:00",
  "gpuType": "A"
}}
"""
    bedrock = boto3.client('bedrock-runtime')
    body = {
        "messages": [
            {"role": "user", "content": [{"text": prompt}]}
        ]
    }
    response = bedrock.invoke_model(
        modelId="us.amazon.nova-lite-v1:0",
        body=json.dumps(body),
        contentType="application/json"
    )
    result = json.loads(response['body'].read())
    print("Bedrock response:", result)
    output = result['output']['message']['content'][0]['text']
    match = re.search(r'\{.*\}', output, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    else:
        raise Exception("パラメータ抽出に失敗しました")

def lambda_handler(event, context):
    try:
        print("Received event:", json.dumps(event))

        # Cognitoで認証されたユーザー情報を取得
        user_info = None
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            user_info = event['requestContext']['authorizer']['claims']
            print(f"Authenticated user: {user_info.get('email') or user_info.get('cognito:username')}")

        # リクエストボディの解析
        body = json.loads(event['body'])
        action = body.get('action', 'list')

        # DynamoDBクライアント
        dynamodb = boto3.resource('dynamodb')
        reservations_table = dynamodb.Table('GpuReservations')

        # ユーザーID（Cognitoのsub）
        user_id = user_info.get('sub') if user_info else None
        if not user_id:
            raise Exception('ユーザー情報が取得できません')

        # 予約登録
        if action == 'reserve':
            details = body.get('details')
            start_time = body.get('startTime')
            end_time = body.get('endTime')
            gpu_type = body.get('gpuType')
            if not (details and start_time and end_time and gpu_type):
                raise Exception('予約内容(details)、開始時刻(startTime)、終了時刻(endTime)、GPU種別(gpuType)が必要です')
            reservation_id = str(uuid.uuid4())

            # 重複予約チェック
            resp = reservations_table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr('gpuType').eq(gpu_type) &
                                 boto3.dynamodb.conditions.Attr('status').is_in(['pending', 'need_confirm']) &
                                 (
                                     (boto3.dynamodb.conditions.Attr('startTime').between(start_time, end_time)) |
                                     (boto3.dynamodb.conditions.Attr('endTime').between(start_time, end_time))
                                 )
            )
            conflicts = resp.get('Items', [])

            status = 'pending'
            priority = 'normal'
            if conflicts:
                # 既存予約とAIで優先度判定
                existing = conflicts[0]  # ここでは最初の衝突予約と比較
                ai_result = ai_priority_decision(details, existing['details'])
                if ai_result == 'new':
                    # 新規予約を優先
                    # 既存予約をneed_confirmに変更
                    reservations_table.update_item(
                        Key={'userId': existing['userId'], 'reservationId': existing['reservationId']},
                        UpdateExpression='SET #s = :n',
                        ExpressionAttributeNames={'#s': 'status'},
                        ExpressionAttributeValues={':n': 'need_confirm'}
                    )
                    status = 'pending'
                    priority = 'high'
                else:
                    # 既存予約を優先
                    status = 'need_confirm'
                    priority = 'low'
            item = {
                'userId': user_id,
                'reservationId': reservation_id,
                'details': details,
                'status': status,
                'priority': priority,
                'startTime': start_time,
                'endTime': end_time,
                'gpuType': gpu_type
            }
            reservations_table.put_item(Item=item)
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"success": True, "reservationId": reservation_id, "status": status, "priority": priority})
            }

        # 予約一覧取得
        elif action == 'list':
            resp = reservations_table.query(
                KeyConditionExpression=boto3.dynamodb.conditions.Key('userId').eq(user_id)
            )
            reservations = resp.get('Items', [])
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"success": True, "reservations": reservations})
            }

        # 予約キャンセル
        elif action == 'cancel':
            reservation_id = body.get('reservationId')
            if not reservation_id:
                raise Exception('reservationIdが必要です')
            # statusをcanceledに更新
            reservations_table.update_item(
                Key={'userId': user_id, 'reservationId': reservation_id},
                UpdateExpression='SET #s = :c',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':c': 'canceled'}
            )
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"success": True})
            }

        # 拒否確認フロー
        elif action == 'confirm_reject':
            reservation_id = body.get('reservationId')
            decision = body.get('decision')  # 'accept' or 'dispute'
            if not reservation_id or decision not in ['accept', 'dispute']:
                raise Exception('reservationIdとdecision(accept/dispute)が必要です')
            if decision == 'accept':
                # ユーザーが拒否を承諾→statusをcanceled
                reservations_table.update_item(
                    Key={'userId': user_id, 'reservationId': reservation_id},
                    UpdateExpression='SET #s = :c',
                    ExpressionAttributeNames={'#s': 'status'},
                    ExpressionAttributeValues={':c': 'canceled'}
                )
            else:
                # ユーザーが異議あり→statusをpendingに戻す
                reservations_table.update_item(
                    Key={'userId': user_id, 'reservationId': reservation_id},
                    UpdateExpression='SET #s = :p',
                    ExpressionAttributeNames={'#s': 'status'},
                    ExpressionAttributeValues={':p': 'pending'}
                )
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"success": True})
            }

        elif action == 'reserve_gpu_from_nlp':
            nlp_text = body['payload']['natural_language_request']
            extracted = extract_params_from_nlp(nlp_text)
            details = nlp_text
            start_time = extracted['startTime']
            end_time = extracted['endTime']
            gpu_type = extracted['gpuType']
            reservation_id = str(uuid.uuid4())
            status = 'pending'
            priority = 'normal'
            item = {
                'userId': user_id,
                'reservationId': reservation_id,
                'details': details,
                'status': status,
                'priority': priority,
                'startTime': start_time,
                'endTime': end_time,
                'gpuType': gpu_type
            }
            reservations_table.put_item(Item=item)
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"success": True, "reservationId": reservation_id, "status": status, "priority": priority})
            }

        else:
            return {
                "statusCode": 400,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"success": False, "error": "不明なアクションです"})
            }

    except Exception as error:
        print("Error:", str(error))
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "OPTIONS,POST"
            },
            "body": json.dumps({
                "success": False,
                "error": str(error)
            })
        }
