import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const templateDetectionTool = createTool({
  id: "template-detection",
  description: "检测消息是否符合广告模板（求购、出售等）",
  
  inputSchema: z.object({
    text: z.string().describe("消息文本内容"),
    hasMedia: z.boolean().default(false).describe("是否包含图片或视频"),
  }),
  
  outputSchema: z.object({
    isValid: z.boolean(),
    reason: z.string(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [TemplateDetectionTool] 检测消息模板:', {
      textLength: context.text?.length || 0,
      hasMedia: context.hasMedia,
    });
    
    const text = context.text || "";
    const hasMedia = context.hasMedia || false;
    
    if (!text) {
      return {
        isValid: false,
        reason: "消息文本为空",
      };
    }
    
    const t = text.toLowerCase();
    
    // 排除规则/公告类
    const excludePatterns = [
      "交易需谨慎", "广告模板", "人工审核", "无关信息请勿发布", 
      "频道", "发布出售信息", "本平台"
    ];
    
    for (const pattern of excludePatterns) {
      if (t.includes(pattern.toLowerCase())) {
        logger?.info('❌ [TemplateDetectionTool] 匹配排除规则:', pattern);
        return {
          isValid: false,
          reason: `匹配排除规则: ${pattern}`,
        };
      }
    }
    
    // 求购模板检测
    if (t.includes("求购")) {
      // 检测是否包含联系方式关键词
      const contactPatterns = /微信|电话|qq|联系|手机|wx|vx|tel/;
      // 检测是否包含价格相关关键词
      const pricePatterns = /价格|预算|元|块|rmb|￥|¥/;
      
      if (contactPatterns.test(t) || pricePatterns.test(t)) {
        logger?.info('✅ [TemplateDetectionTool] 匹配求购模板');
        return {
          isValid: true,
          reason: "匹配求购模板",
        };
      }
    }
    
    // 出售模板检测
    if (t.includes("出售") || t.includes("转让")) {
      const matchCount = (t.match(/价格|位置|联系方式|物品|介绍|交易/g) || []).length;
      if (matchCount >= 2) {
        logger?.info('✅ [TemplateDetectionTool] 匹配出售模板');
        return {
          isValid: true,
          reason: "匹配出售模板",
        };
      }
    }
    
    // 有媒体且文字长度够
    if (hasMedia && text.length > 15) {
      logger?.info('✅ [TemplateDetectionTool] 有媒体且文字充足');
      return {
        isValid: true,
        reason: "包含媒体且文字充足",
      };
    }
    
    logger?.info('❌ [TemplateDetectionTool] 不符合任何模板');
    return {
      isValid: false,
      reason: "不符合任何广告模板",
    };
  },
});
