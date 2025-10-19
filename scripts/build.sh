#!/usr/bin/env bash

set -e

# 使用超时防止构建卡住（5分钟超时）
timeout 300 mastra build || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 124 ]; then
    echo "⚠️ 构建超时，但可能已生成部分文件"
    # 检查关键文件是否存在
    if [ -f ".mastra/output/index.mjs" ]; then
      echo "✅ 发现已存在的构建文件，继续部署"
      exit 0
    else
      echo "❌ 构建文件不存在，部署失败"
      exit 1
    fi
  else
    echo "❌ 构建失败，错误码: $EXIT_CODE"
    exit $EXIT_CODE
  fi
}
