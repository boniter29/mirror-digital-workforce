import { describe, expect, it } from "vitest";
import { buildContextArtifact, buildQaArtifact, buildStyleArtifact, mergeMessageEvidence, parseMessagePage, parseProfileList } from "../src/main/dws-evidence";

const selfId = "open-self";
const response = {
  success: true,
  result: {
    hasMore: true,
    nextCursor: "next-1",
    conversationMessagesList: [
      {
        openConversationId: "cid-1",
        singleChat: false,
        title: "项目群",
        messages: [
          { openMessageId: "m1", content: "现在怎么处理？", createTime: "2026-08-01 10:00:00", sender: "同事", senderOpenDingTalkId: "other", openConversationId: "cid-1" },
          { openMessageId: "m2", content: "先把问题拆开，今天把第一版跑通。", createTime: "2026-08-01 10:01:00", sender: "示例主管", senderOpenDingTalkId: selfId, openConversationId: "cid-1" },
          { openMessageId: "m3", content: "别人的表达不能学", createTime: "2026-08-01 10:02:00", sender: "同事", senderOpenDingTalkId: "other", openConversationId: "cid-1" },
        ],
      },
    ],
  },
};

describe("DWS evidence parsing", () => {
  it("flattens the real conversationMessagesList response instead of returning zero items", () => {
    const page = parseMessagePage(response);
    expect(page.messages).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("next-1");
    expect(page.messages[0].conversationTitle).toBe("项目群");
  });

  it("uses only self-authored messages as voice evidence", () => {
    const page = parseMessagePage(response);
    const style = buildStyleArtifact(page.messages, selfId);
    expect(style.statistics.authored_messages_collected).toBe(1);
    expect(style.samples.map((item) => item.content)).toEqual(["先把问题拆开，今天把第一版跑通。"]) ;
  });

  it("keeps other senders only as reply context", () => {
    const context = buildContextArtifact(parseMessagePage(response).messages, selfId);
    expect(context.reply_pairs).toHaveLength(1);
    expect(context.reply_pairs[0]).toMatchObject({ incoming: "现在怎么处理？", reply: "先把问题拆开，今天把第一版跑通。" });
  });

  it("prioritizes @me and private-chat questions into a grounded Q&A playbook", () => {
    const mentions = parseMessagePage(response, { mentionedMe: true }).messages;
    const privateMessages = parseMessagePage({
      success: true,
      result: {
        hasMore: false,
        nextCursor: "",
        conversationMessagesList: [{
          openConversationId: "cid-private",
          singleChat: true,
          title: "同事",
          messages: [
            { openMessageId: "p1", content: "这个方案要不要继续？", createTime: "2026-08-01 11:00:00", sender: "同事", senderOpenDingTalkId: "other", openConversationId: "cid-private" },
            { openMessageId: "p2", content: "先停一下，把真实用户反馈补齐。", createTime: "2026-08-01 11:01:00", sender: "示例主管", senderOpenDingTalkId: selfId, openConversationId: "cid-private" },
          ],
        }],
      },
    }).messages;
    const qa = buildQaArtifact(mergeMessageEvidence(mentions, privateMessages), selfId);
    expect(qa.statistics.mention_questions_collected).toBeGreaterThan(0);
    expect(qa.statistics.private_questions_collected).toBe(1);
    expect(qa.qa_pairs.some((pair) => pair.answer.includes("真实用户反馈"))).toBe(true);
    expect(qa.statistics.distinct_scenario_signals).toBeGreaterThan(0);
    expect(qa.scenario_signals.some((signal) => signal.examples.length > 0)).toBe(true);
  });

  it("uses quoted messages as direct question-answer evidence", () => {
    const page = parseMessagePage({ success: true, result: { hasMore: false, nextCursor: "", conversationMessagesList: [{ openConversationId: "cid-2", singleChat: false, title: "项目群", messages: [{ openMessageId: "q2", content: "先验证两周。", createTime: "2026-08-01 12:00:00", sender: "示例主管", senderOpenDingTalkId: selfId, quotedMessage: { openMessageId: "q1", content: "要不要直接全量上线？", sender: "同事", senderOpenDingTalkId: "other" } }] }] } });
    const qa = buildQaArtifact(page.messages, selfId);
    expect(qa.qa_pairs[0]).toMatchObject({ question: "要不要直接全量上线？", answer: "先验证两周。", trigger: "quoted_reply" });
  });

  it("selects an explicit active DWS profile", () => {
    const profile = parseProfileList({ success: true, currentProfile: "corp:user", profiles: [{ profile: "corp:user", corpId: "corp", corpName: "组织", userId: "user", userName: "示例主管", status: "active", isCurrent: true }] }, "corp:user");
    expect(profile.userName).toBe("示例主管");
  });

  it("allows an expired access token when DWS can still refresh it", () => {
    const profile = parseProfileList({ success: true, currentProfile: "corp:user", profiles: [{ profile: "corp:user", corpId: "corp", corpName: "组织", userId: "user", userName: "示例主管", status: "expired", refreshExpAt: "2099-01-01T00:00:00+08:00" }] });
    expect(profile.status).toBe("expired");
  });

  it("does not silently accept an unknown message envelope", () => {
    expect(() => parseMessagePage({ success: true, result: { items: [] } })).toThrow("conversationMessagesList");
  });
});
