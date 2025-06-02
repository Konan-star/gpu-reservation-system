# lambda/index.py
import json
import os
import re  # 正規表現モジュールをインポート
import urllib.request # urllib.request をインポート
import urllib.parse # urllib.parse をインポート
from botocore.exceptions import ClientError 

# Lambda コンテキストからリージョンを抽出する関数
def extract_region_from_arn(arn):
    # ARN 形式: arn:aws:lambda:region:account-id:function:function-name
    match = re.search('arn:aws:lambda:([^:]+):', arn)
    if match:
        return match.group(1)
    return "us-east-1"  # デフォルト値

# FastAPIエンドポイントのURLを環境変数から取得
# 環境変数 'FASTAPI_ENDPOINT_URL' にFastAPIのURLを設定
FASTAPI_ENDPOINT_URL = os.environ.get("FASTAPI_ENDPOINT_URL")

# Bedrockクライアントの初期化は不要になるためコメントアウト
# bedrock_client = None
# MODEL_ID = os.environ.get("MODEL_ID", "us.amazon.nova-lite-v1:0")

def lambda_handler(event, context):
    try:
        # FastAPIエンドポイントURLが設定されているか確認
        if not FASTAPI_ENDPOINT_URL:
            raise ValueError("Environment variable 'FASTAPI_ENDPOINT_URL' is not set.")

        # Bedrockクライアント初期化部分をコメントアウト
        # global bedrock_client
        # if bedrock_client is None:
        #     region = extract_region_from_arn(context.invoked_function_arn)
        #     bedrock_client = boto3.client('bedrock-runtime', region_name=region)
        #     print(f"Initialized Bedrock client in region: {region}")

        print("Received event:", json.dumps(event))

        # Cognitoで認証されたユーザー情報を取得 (現状維持)
        user_info = None
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            user_info = event['requestContext']['authorizer']['claims']
            print(f"Authenticated user: {user_info.get('email') or user_info.get('cognito:username')}")

        # リクエストボディの解析 (現状維持)
        body = json.loads(event['body'])
        message = body['message']
        conversation_history = body.get('conversationHistory', [])

        print("Processing message:", message)
        # print("Using model:", MODEL_ID) # 不要

        # --- FastAPIエンドポイント呼び出し処理 ---
        # FastAPIに送信するデータを作成
        # FastAPI側が受け取る形式に合わせて 'prompt' キーでメッセージを渡す
        # 会話履歴も必要であれば含める
        request_data = {
            "prompt": message,
            "conversationHistory": conversation_history # 必要に応じてFastAPIに渡す
        }
        post_data = json.dumps(request_data).encode('utf-8')

        print(f"Calling FastAPI endpoint: {FASTAPI_ENDPOINT_URL}")
        print(f"Sending data: {json.dumps(request_data)}")

        # urllib.request を使用してPOSTリクエストを送信
        req = urllib.request.Request(
            FASTAPI_ENDPOINT_URL,
            data=post_data,
            headers={'Content-Type': 'application/json'},
            method='POST' # 明示的にPOSTメソッドを指定
        )

        try:
            with urllib.request.urlopen(req) as response:
                # レスポンスコードを確認
                if response.getcode() == 200:
                    response_body = response.read().decode('utf-8')
                    print(f"Received response from FastAPI: {response_body}")
                    # FastAPIからのレスポンスを解析 (FastAPIのレスポンス形式に合わせる)
                    api_response = json.loads(response_body)
                    assistant_response = api_response.get("generated_text") # FastAPIのレスポンスのキーに合わせ、今回はlogを見た感じgenerated_textだった
                    updated_history = api_response.get("conversationHistory", conversation_history) 

                    if not assistant_response:
                        raise Exception("No generated_text content received from FastAPI endpoint.")

                    # 新しい会話履歴を作成（FastAPIが完全な履歴を返さない場合）
                    messages = conversation_history.copy()
                    messages.append({"role": "user", "content": message})
                    messages.append({"role": "assistant", "content": assistant_response})

                else:
                    raise Exception(f"FastAPI endpoint returned status code {response.getcode()}")
        except urllib.error.HTTPError as e:
            # HTTPエラー（4xx, 5xx）の場合
            error_content = e.read().decode('utf-8') if e.readable() else 'No details'
            print(f"HTTP Error calling FastAPI: {e.code} {e.reason} - {error_content}")
            raise Exception(f"Failed to call FastAPI endpoint: {e.code} {e.reason}")
        except urllib.error.URLError as e:
            # URL関連のエラー（接続失敗など）の場合
            print(f"URL Error calling FastAPI: {e.reason}")
            raise Exception(f"Failed to connect to FastAPI endpoint: {e.reason}")
        # --- FastAPIエンドポイント呼び出し処理 終了 ---

        # 成功レスポンスの返却 (応答と会話履歴を更新)
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "OPTIONS,POST"
            },
            "body": json.dumps({
                "success": True,
                "response": assistant_response,
                "conversationHistory": messages # 更新された会話履歴を返す
            })
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
