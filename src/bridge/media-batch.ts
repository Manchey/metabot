import type { IncomingMessage } from '../types.js';
import { DEFAULT_FILE_TEXT, DEFAULT_IMAGE_TEXT } from './bridge-constants.js';

export interface PendingBatch {
  messages: IncomingMessage[];
  timerId: ReturnType<typeof setTimeout>;
}

export function isDefaultMediaText(msg: IncomingMessage): boolean {
  return (!!msg.imageKey && msg.text === DEFAULT_IMAGE_TEXT)
    || (!!msg.fileKey && msg.text === DEFAULT_FILE_TEXT);
}

export function mergeBatchMessages(messages: IncomingMessage[]): IncomingMessage {
  const first = messages[0];
  if (messages.length === 1) return first;

  const imageCount = messages.filter((m) => m.imageKey).length;
  const fileCount = messages.filter((m) => m.fileKey).length;
  const parts: string[] = [];
  if (imageCount > 0) parts.push(`${imageCount}张图片`);
  if (fileCount > 0) parts.push(`${fileCount}个文件`);

  return {
    ...first,
    text: `请分析这些${parts.join('和')}`,
    extraMedia: messages.slice(1).map((m) => ({
      messageId: m.messageId,
      imageKey: m.imageKey,
      fileKey: m.fileKey,
      fileName: m.fileName,
    })),
  };
}

export function mergeBatchWithText(batchMsgs: IncomingMessage[], textMsg: IncomingMessage): IncomingMessage {
  return {
    ...textMsg,
    extraMedia: batchMsgs.map((m) => ({
      messageId: m.messageId,
      imageKey: m.imageKey,
      fileKey: m.fileKey,
      fileName: m.fileName,
    })),
  };
}
