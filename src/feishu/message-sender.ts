import * as fs from 'node:fs';
import type * as lark from '@larksuiteoapi/node-sdk';
import type { Logger } from '../utils/logger.js';

export class MessageSender {
  private userNameCache = new Map<string, string>();

  constructor(
    private client: lark.Client,
    private logger: Logger,
  ) {}

  async sendCard(chatId: string, cardContent: string): Promise<string | undefined> {
    try {
      const resp = await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: cardContent,
          msg_type: 'interactive',
        },
      });

      const messageId = resp?.data?.message_id;
      if (!messageId) {
        this.logger.error({ resp }, 'Failed to get message_id from send response');
      }
      return messageId;
    } catch (err) {
      this.logger.error({ err, chatId }, 'Failed to send card');
      return undefined;
    }
  }

  /**
   * Reply to a message with a card, optionally in a thread.
   * @param messageId - The message ID to reply to
   * @param cardContent - The card JSON content
   * @param replyInThread - If true, reply appears in the message's thread instead of main chat
   * @returns The new message ID if successful
   */
  async replyCard(messageId: string, cardContent: string, replyInThread: boolean = false): Promise<string | undefined> {
    try {
      const resp = await this.client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          content: cardContent,
          msg_type: 'interactive',
          reply_in_thread: replyInThread,
        },
      });

      const newMessageId = resp?.data?.message_id;
      if (!newMessageId) {
        this.logger.error({ resp }, 'Failed to get message_id from reply response');
      }
      this.logger.info({ messageId, newMessageId, replyInThread }, 'Card reply sent');
      return newMessageId;
    } catch (err) {
      this.logger.error({ err, messageId, replyInThread }, 'Failed to reply card');
      return undefined;
    }
  }

  async updateCard(messageId: string, cardContent: string): Promise<boolean> {
    try {
      await this.client.im.v1.message.patch({
        path: { message_id: messageId },
        data: { content: cardContent },
      });
      return true;
    } catch (err: any) {
      const apiMsg = err?.msg || err?.message || String(err);
      const apiCode = err?.code || err?.error?.code;
      this.logger.error({ err, messageId, apiCode, apiMsg, contentLen: cardContent?.length }, 'Failed to update card');
      return false;
    }
  }

  async downloadImage(messageId: string, imageKey: string, savePath: string): Promise<boolean> {
    try {
      const resp = await this.client.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: imageKey },
        params: { type: 'image' },
      });

      if (resp) {
        await (resp as any).writeFile(savePath);
        this.logger.info({ messageId, imageKey, savePath }, 'Image downloaded');
        return true;
      }
      this.logger.error({ messageId, imageKey }, 'Empty response when downloading image');
      return false;
    } catch (err) {
      this.logger.error({ err, messageId, imageKey }, 'Failed to download image');
      return false;
    }
  }

  async downloadFile(messageId: string, fileKey: string, savePath: string): Promise<boolean> {
    try {
      const resp = await this.client.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: 'file' },
      });

      if (resp) {
        await (resp as any).writeFile(savePath);
        this.logger.info({ messageId, fileKey, savePath }, 'File downloaded');
        return true;
      }
      this.logger.error({ messageId, fileKey }, 'Empty response when downloading file');
      return false;
    } catch (err) {
      this.logger.error({ err, messageId, fileKey }, 'Failed to download file');
      return false;
    }
  }

  async uploadImage(filePath: string): Promise<string | undefined> {
    try {
      const resp = await this.client.im.v1.image.create({
        data: {
          image_type: 'message',
          image: fs.createReadStream(filePath),
        },
      });
      const imageKey = resp?.image_key;
      if (imageKey) {
        this.logger.info({ filePath, imageKey }, 'Image uploaded to Feishu');
      }
      return imageKey;
    } catch (err) {
      this.logger.error({ err, filePath }, 'Failed to upload image');
      return undefined;
    }
  }

  async sendImage(chatId: string, imageKey: string): Promise<boolean> {
    try {
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ image_key: imageKey }),
          msg_type: 'image',
        },
      });
      return true;
    } catch (err) {
      this.logger.error({ err, chatId, imageKey }, 'Failed to send image');
      return false;
    }
  }

  async sendImageFile(chatId: string, filePath: string): Promise<boolean> {
    const imageKey = await this.uploadImage(filePath);
    if (!imageKey) return false;
    return this.sendImage(chatId, imageKey);
  }

  /**
   * Reply to a message with an image, optionally in a thread.
   * Uploads the image first, then replies with the image_key.
   */
  async replyImageFile(messageId: string, filePath: string, replyInThread: boolean = true): Promise<boolean> {
    const imageKey = await this.uploadImage(filePath);
    if (!imageKey) return false;
    return this.replyImage(messageId, imageKey, replyInThread);
  }

  /**
   * Reply to a message with an image key, optionally in a thread.
   */
  async replyImage(messageId: string, imageKey: string, replyInThread: boolean = true): Promise<boolean> {
    try {
      await this.client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ image_key: imageKey }),
          msg_type: 'image',
          reply_in_thread: replyInThread,
        },
      });
      this.logger.info({ messageId, imageKey, replyInThread }, 'Image reply sent');
      return true;
    } catch (err) {
      this.logger.error({ err, messageId, imageKey, replyInThread }, 'Failed to reply image');
      return false;
    }
  }

  async uploadFile(filePath: string, fileName: string, fileType: string): Promise<string | undefined> {
    try {
      const resp = await this.client.im.v1.file.create({
        data: {
          file_type: fileType as any,
          file_name: fileName,
          file: fs.createReadStream(filePath),
        },
      });
      const fileKey = resp?.file_key;
      if (fileKey) {
        this.logger.info({ filePath, fileKey, fileType }, 'File uploaded to Feishu');
      }
      return fileKey;
    } catch (err) {
      this.logger.error({ err, filePath, fileType }, 'Failed to upload file');
      return undefined;
    }
  }

  async sendFile(chatId: string, fileKey: string): Promise<boolean> {
    try {
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ file_key: fileKey }),
          msg_type: 'file',
        },
      });
      return true;
    } catch (err) {
      this.logger.error({ err, chatId, fileKey }, 'Failed to send file');
      return false;
    }
  }

  async sendLocalFile(chatId: string, filePath: string, fileName: string, fileType: string): Promise<boolean> {
    const fileKey = await this.uploadFile(filePath, fileName, fileType);
    if (!fileKey) return false;
    return this.sendFile(chatId, fileKey);
  }

  /**
   * Reply to a message with a file, optionally in a thread.
   * Uploads the file first, then replies with the file_key.
   */
  async replyLocalFile(messageId: string, filePath: string, fileName: string, fileType: string, replyInThread: boolean = true): Promise<boolean> {
    const fileKey = await this.uploadFile(filePath, fileName, fileType);
    if (!fileKey) return false;
    return this.replyFile(messageId, fileKey, replyInThread);
  }

  /**
   * Reply to a message with a file key, optionally in a thread.
   */
  async replyFile(messageId: string, fileKey: string, replyInThread: boolean = true): Promise<boolean> {
    try {
      await this.client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ file_key: fileKey }),
          msg_type: 'file',
          reply_in_thread: replyInThread,
        },
      });
      this.logger.info({ messageId, fileKey, replyInThread }, 'File reply sent');
      return true;
    } catch (err) {
      this.logger.error({ err, messageId, fileKey, replyInThread }, 'Failed to reply file');
      return false;
    }
  }

  async getChatMemberCount(chatId: string): Promise<number | undefined> {
    try {
      const resp: any = await this.client.im.v1.chat.get({
        path: { chat_id: chatId },
      });
      const userCount = parseInt(resp?.data?.user_count, 10) || 0;
      const botCount = parseInt(resp?.data?.bot_count, 10) || 0;
      const total = userCount + botCount;
      this.logger.debug({ chatId, userCount, botCount, total }, 'Chat member count retrieved');
      return total;
    } catch (err) {
      this.logger.error({ err, chatId }, 'Failed to get chat member count (may need im:chat:readonly permission)');
      return undefined;
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    try {
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
      });
    } catch (err) {
      this.logger.error({ err, chatId }, 'Failed to send text');
    }
  }

  /**
   * Reply to a message with text, optionally in a thread.
   * @param messageId - The message ID to reply to
   * @param text - The text content
   * @param replyInThread - If true, reply appears in the message's thread instead of main chat
   */
  async replyText(messageId: string, text: string, replyInThread: boolean = false): Promise<void> {
    try {
      await this.client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text }),
          msg_type: 'text',
          reply_in_thread: replyInThread,
        },
      });
      this.logger.info({ messageId, replyInThread }, 'Text reply sent');
    } catch (err) {
      this.logger.error({ err, messageId, replyInThread }, 'Failed to reply text');
    }
  }

  /**
   * Add an emoji reaction to a message.
   * @param messageId - The message ID to add reaction to
   * @param emojiType - Emoji type, e.g. "OK", "DONE", "THUMBSUP", "HEART", "HOURGLASS"
   * @returns reaction_id if successful, undefined otherwise
   */
  async addReaction(messageId: string, emojiType: string): Promise<string | undefined> {
    try {
      const resp = await this.client.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: { emoji_type: emojiType },
        },
      });
      const reactionId = resp?.data?.reaction_id;
      this.logger.info({ messageId, emojiType, reactionId }, 'Reaction added to message');
      return reactionId;
    } catch (err) {
      this.logger.error({ err, messageId, emojiType }, 'Failed to add reaction');
      return undefined;
    }
  }

  /**
   * Remove an emoji reaction from a message.
   * @param messageId - The message ID the reaction is on
   * @param reactionId - The reaction ID to remove (obtained from addReaction response)
   * @returns true if successful, false otherwise
   */
  async removeReaction(messageId: string, reactionId: string): Promise<boolean> {
    try {
      await this.client.im.v1.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      });
      this.logger.info({ messageId, reactionId }, 'Reaction removed from message');
      return true;
    } catch (err) {
      this.logger.error({ err, messageId, reactionId }, 'Failed to remove reaction');
      return false;
    }
  }

  /** Resolve Feishu open_ids to display names via contact API. Caches results. */
  async resolveUserNames(openIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uncached: string[] = [];

    for (const id of openIds) {
      if (this.userNameCache.has(id)) {
        result.set(id, this.userNameCache.get(id)!);
      } else {
        uncached.push(id);
      }
    }

    for (const id of uncached) {
      try {
        const resp = await this.client.contact.v3.user.get({
          path: { user_id: id },
          params: { user_id_type: 'open_id' },
        });
        const name = (resp?.data as any)?.user?.name;
        if (name) {
          this.userNameCache.set(id, name);
          result.set(id, name);
        } else {
          result.set(id, id);
        }
      } catch (err) {
        this.logger.warn({ err, openId: id }, 'Failed to resolve user name, using raw ID');
        result.set(id, id);
      }
    }

    return result;
  }
}
