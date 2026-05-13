import * as path from 'node:path';
import type { IMessageSender } from '../bridge/message-sender.interface.js';
import type { CardState } from '../types.js';
import { MessageSender } from './message-sender.js';
import { buildCard, buildTextCard } from './card-builder.js';
import { buildCardV2, buildTextCardV2 } from './card-builder-v2.js';
import { OutputsManager } from '../bridge/outputs-manager.js';

// v2 (native table + lark_md headings + grey footer) is the default.
// Set CARD_SCHEMA_V2=false to opt out and fall back to v1.
const USE_V2 = process.env.CARD_SCHEMA_V2 !== 'false';

/**
 * Adapts the Feishu-specific MessageSender to the platform-agnostic IMessageSender interface.
 * Handles card building (CardState → Feishu JSON) internally.
 */
export class FeishuSenderAdapter implements IMessageSender {
  constructor(private sender: MessageSender) {}

  async sendCard(chatId: string, state: CardState): Promise<string | undefined> {
    return this.sender.sendCard(chatId, USE_V2 ? buildCardV2(state) : buildCard(state));
  }

  async replyCard(messageId: string, state: CardState, replyInThread: boolean): Promise<string | undefined> {
    return this.sender.replyCard(messageId, buildCard(state), replyInThread);
  }

  async updateCard(messageId: string, state: CardState): Promise<boolean> {
    return this.sender.updateCard(messageId, USE_V2 ? buildCardV2(state) : buildCard(state));
  }

  async sendTextNotice(chatId: string, title: string, content: string, color: string = 'blue'): Promise<void> {
    await this.sender.sendCard(chatId, USE_V2 ? buildTextCardV2(title, content, color) : buildTextCard(title, content, color));
  }

  async replyTextNotice(messageId: string, title: string, content: string, color: string = 'blue', replyInThread: boolean = true): Promise<void> {
    await this.sender.replyCard(messageId, buildTextCard(title, content, color), replyInThread);
  }

  async sendText(chatId: string, text: string): Promise<void> {
    return this.sender.sendText(chatId, text);
  }

  async replyText(messageId: string, text: string, replyInThread: boolean = true): Promise<void> {
    return this.sender.replyText(messageId, text, replyInThread);
  }

  async sendImageFile(chatId: string, filePath: string): Promise<boolean> {
    return this.sender.sendImageFile(chatId, filePath);
  }

  async replyImageFile(messageId: string, filePath: string, replyInThread: boolean = true): Promise<boolean> {
    return this.sender.replyImageFile(messageId, filePath, replyInThread);
  }

  async sendLocalFile(chatId: string, filePath: string, fileName: string): Promise<boolean> {
    const ext = path.extname(fileName).toLowerCase();
    const feishuType = OutputsManager.feishuFileType(ext);
    return this.sender.sendLocalFile(chatId, filePath, fileName, feishuType);
  }

  async replyLocalFile(messageId: string, filePath: string, fileName: string, replyInThread: boolean = true): Promise<boolean> {
    const ext = path.extname(fileName).toLowerCase();
    const feishuType = OutputsManager.feishuFileType(ext);
    return this.sender.replyLocalFile(messageId, filePath, fileName, feishuType, replyInThread);
  }

  async downloadImage(messageId: string, imageKey: string, savePath: string): Promise<boolean> {
    return this.sender.downloadImage(messageId, imageKey, savePath);
  }

  async downloadFile(messageId: string, fileKey: string, savePath: string): Promise<boolean> {
    return this.sender.downloadFile(messageId, fileKey, savePath);
  }

  async createGroup(name: string, userIdList: string[], description?: string): Promise<string | undefined> {
    return this.sender.createGroup(name, userIdList, description);
  }
}
