#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GpuReservationSystemStack } from '../lib/gpu-reservation-system-stack';

const app = new cdk.App();
new GpuReservationSystemStack(app, 'GpuReservationSystemStack', {
  // モデルIDをオプションで指定可能
  modelId: 'us.amazon.nova-lite-v1:0',
  //modelId: 'us.amazon.nova-micro-v1:0',
  
  // 環境変数から取得したリージョンを使用、またはデフォルトとしてus-east-1を使用
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
});

// タグはスタックレベルで追加
cdk.Tags.of(app).add('Project', 'GpuReservationSystem');
cdk.Tags.of(app).add('Environment', 'Dev');
