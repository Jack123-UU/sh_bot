export type TrafficBtn = { text: string; url: string; order: number };
export type AdTemplate = { name: string; content: string; threshold: number };
export type Suspected = { template: string; score: number };

export type Req = {
  id: string;
  sourceChatId: number | string;
  messageId: number;
  fromId: number;
  fromName: string;
  createdAt: number;
  suspected?: Suspected;
};

export type Config = {
  forwardTargetId: string;     // 目标转发ID
  reviewTargetId?: string;     // 审核频道/群/私人
  welcomeText: string;
  attachButtonsToTargetMeta: boolean;
  adminIds: string[];
  allowlistMode: boolean;
  adtplDefaultThreshold: number;
};