import { describe, it, expect } from "vitest";
import {
  applyIncomingMessage,
  applyReadReceipt,
  getMessageConversationId,
  getMessageSenderId,
  getMessageId,
} from "./chatList";

const me = "user-me";
const them = "user-them";

const chat = (id, unread = 0, lastMessage = null) => ({
  id,
  unreadCount: unread,
  lastMessage,
});

describe("chatList helpers", () => {
  describe("getMessageConversationId", () => {
    it("reads conversation_id", () => {
      expect(getMessageConversationId({ conversation_id: "c1" })).toBe("c1");
    });
    it("reads conversationId", () => {
      expect(getMessageConversationId({ conversationId: "c2" })).toBe("c2");
    });
    it("returns null when absent", () => {
      expect(getMessageConversationId({})).toBeNull();
    });
  });

  describe("getMessageSenderId", () => {
    it("reads sender_id", () => {
      expect(getMessageSenderId({ sender_id: "s1" })).toBe("s1");
    });
    it("reads senderId", () => {
      expect(getMessageSenderId({ senderId: "s2" })).toBe("s2");
    });
    it("returns null when absent", () => {
      expect(getMessageSenderId({})).toBeNull();
    });
  });

  describe("getMessageId", () => {
    it("reads id", () => {
      expect(getMessageId({ id: "m1" })).toBe("m1");
    });
    it("reads _id", () => {
      expect(getMessageId({ _id: "m2" })).toBe("m2");
    });
    it("returns null when absent", () => {
      expect(getMessageId({})).toBeNull();
    });
  });

  describe("applyIncomingMessage", () => {
    it("returns found:false for a message with no conversationId", () => {
      const chats = [chat("c1")];
      const result = applyIncomingMessage(chats, { id: "m1", sender_id: them }, me);
      expect(result.found).toBe(false);
      expect(result.chats).toBe(chats);
    });

    it("returns found:false for an unknown conversation", () => {
      const chats = [chat("c1")];
      const result = applyIncomingMessage(chats, { id: "m1", conversation_id: "c9", sender_id: them }, me);
      expect(result.found).toBe(false);
      expect(result.conversationId).toBe("c9");
    });

    it("increments unread and moves to top for another user's message", () => {
      const chats = [chat("c1", 0), chat("c2", 3)];
      const result = applyIncomingMessage(
        chats,
        { id: "m1", conversation_id: "c1", sender_id: them, content: "hi" },
        me
      );
      expect(result.found).toBe(true);
      expect(result.incremented).toBe(true);
      expect(result.chats[0].id).toBe("c1");
      expect(result.chats[0].unreadCount).toBe(1);
      expect(result.chats[0].lastMessage.content).toBe("hi");
      // c2 stays second
      expect(result.chats[1].id).toBe("c2");
    });

    it("does not increment unread for the current user's own message", () => {
      const chats = [chat("c1", 3)];
      const result = applyIncomingMessage(
        chats,
        { id: "m1", conversation_id: "c1", sender_id: me, content: "hi" },
        me
      );
      expect(result.found).toBe(true);
      expect(result.incremented).toBe(false);
      expect(result.chats[0].unreadCount).toBe(3);
    });

    it("updates preview even when unread is unchanged (own message reorders)", () => {
      const chats = [chat("c2", 0), chat("c1", 2)];
      const result = applyIncomingMessage(
        chats,
        { id: "m1", conversation_id: "c1", sender_id: me, content: "owned" },
        me
      );
      expect(result.chats[0].id).toBe("c1");
      expect(result.chats[0].lastMessage.content).toBe("owned");
    });

    it("is idempotent: same list shape on repeated application", () => {
      const chats = [chat("c1", 0)];
      const m = { id: "m1", conversation_id: "c1", sender_id: them, content: "x" };
      const first = applyIncomingMessage(chats, m, me);
      const second = applyIncomingMessage(first.chats, m, me);
      expect(second.chats[0].unreadCount).toBe(2);
    });
  });

  describe("applyReadReceipt", () => {
    it("returns the same reference when nothing changed", () => {
      const chats = [chat("c1", 0), chat("c2", 2)];
      const result = applyReadReceipt(chats, "c1", me, me, 0);
      expect(result).toBe(chats);
    });

    it("resets unread to server count when current user read the conversation", () => {
      const chats = [chat("c1", 5), chat("c2", 2)];
      const result = applyReadReceipt(chats, "c1", me, me, 0);
      expect(result).not.toBe(chats);
      expect(result.find((c) => c.id === "c1").unreadCount).toBe(0);
      expect(result.find((c) => c.id === "c2").unreadCount).toBe(2);
    });

    it("ignores read receipts from another user", () => {
      const chats = [chat("c1", 5)];
      const result = applyReadReceipt(chats, "c1", them, me, 0);
      expect(result).toBe(chats);
    });

    it("does nothing when conversationId is missing", () => {
      const chats = [chat("c1", 5)];
      expect(applyReadReceipt(chats, null, me, me, 0)).toBe(chats);
    });

    it("does nothing when the count is unchanged", () => {
      const chats = [chat("c1", 3)];
      const result = applyReadReceipt(chats, "c1", me, me, 3);
      expect(result).toBe(chats);
    });
  });
});
