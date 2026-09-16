export interface DwsProfileRecord {
  profile: string;
  corpId: string;
  corpName: string;
  userId: string;
  userName: string;
  status: string;
  refreshExpAt?: string;
  isCurrent?: boolean;
}

export interface DwsMessageEvidence {
  id: string;
  content: string;
  sentAt: string;
  sender: string;
  senderOpenDingTalkId: string;
  conversationId: string;
  conversationTitle: string;
  conversationType: "single" | "group";
  mentionedMe?: boolean;
  quotedMessage?: {
    id: string;
    content: string;
    sender: string;
    senderOpenDingTalkId: string;
  };
}

export interface DwsMessagePage {
  messages: DwsMessageEvidence[];
  hasMore: boolean;
  nextCursor: string;
}

export function parseProfileList(payload: unknown, requested?: string): DwsProfileRecord {
  const root = record(payload);
  assertDwsSuccess(root, "读取 DWS Profile");
  const profiles = array(root.profiles).map((item) => {
    const value = record(item);
    return {
      profile: string(value.profile),
      corpId: string(value.corpId),
      corpName: string(value.corpName),
      userId: string(value.userId),
      userName: string(value.userName),
      status: string(value.status),
      refreshExpAt: string(value.refreshExpAt) || undefined,
      isCurrent: Boolean(value.isCurrent),
    };
  }).filter((item) => item.profile);
  const currentProfile = string(root.currentProfile);
  const selected = requested
    ? profiles.find((item) => item.profile === requested)
    : profiles.find((item) => item.profile === currentProfile) ?? profiles.find((item) => item.isCurrent);
  if (!selected) throw new Error(requested ? `找不到 DWS Profile：${requested}` : "DWS 没有当前登录身份，请先在 CLI 登录。");
  const refreshStillValid = selected.refreshExpAt && new Date(selected.refreshExpAt).getTime() > Date.now();
  if (selected.status !== "active" && !refreshStillValid) throw new Error(`DWS Profile 当前状态为 ${selected.status || "unknown"}，且刷新凭证不可用，请先重新登录。`);
  return selected;
}

export function parseMessagePage(payload: unknown, options: { mentionedMe?: boolean } = {}): DwsMessagePage {
  const root = record(payload);
  assertDwsSuccess(root, "读取钉钉消息");
  const result = record(root.result);
  if (!("conversationMessagesList" in result)) {
    const hint = string(result.friendly_hint ?? result.friendlyHint ?? root.errorMsg);
    throw new Error(hint || "DWS 消息返回结构缺少 conversationMessagesList，未把未知响应误判为空记录。");
  }
  const messages: DwsMessageEvidence[] = [];
  for (const rawConversation of array(result.conversationMessagesList)) {
    const conversation = record(rawConversation);
    const conversationId = string(conversation.openConversationId);
    const conversationTitle = string(conversation.title) || "未命名会话";
    const conversationType = conversation.singleChat ? "single" as const : "group" as const;
    for (const rawMessage of array(conversation.messages)) {
      const message = record(rawMessage);
      const content = normalizeDwsText(message.content);
      if (!content) continue;
      const quoted = record(message.quotedMessage);
      const quotedContent = normalizeDwsText(quoted.content);
      messages.push({
        id: string(message.openMessageId) || `${conversationId}:${string(message.createTime)}:${messages.length}`,
        content,
        sentAt: string(message.createTime),
        sender: string(message.sender),
        senderOpenDingTalkId: string(message.senderOpenDingTalkId),
        conversationId: string(message.openConversationId) || conversationId,
        conversationTitle,
        conversationType,
        mentionedMe: Boolean(options.mentionedMe),
        quotedMessage: quotedContent ? {
          id: string(quoted.openMessageId),
          content: quotedContent,
          sender: string(quoted.sender),
          senderOpenDingTalkId: string(quoted.senderOpenDingTalkId),
        } : undefined,
      });
    }
  }
  return {
    messages,
    hasMore: Boolean(result.hasMore),
    nextCursor: string(result.nextCursor),
  };
}

export function selectStyleSamples(messages: DwsMessageEvidence[], maxSamples = 520, maxCharacters = 105_000): DwsMessageEvidence[] {
  const unique = dedupeMessages(messages)
    .filter((message) => message.content.length >= 2 && message.content.length <= 3_000)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  if (!unique.length) return [];
  const desired = Math.min(maxSamples, unique.length);
  const sampled: DwsMessageEvidence[] = [];
  let characters = 0;
  for (let index = 0; index < desired; index += 1) {
    const sourceIndex = desired === 1 ? unique.length - 1 : Math.round(index * (unique.length - 1) / (desired - 1));
    const message = unique[sourceIndex];
    if (sampled.some((item) => item.id === message.id)) continue;
    if (characters + message.content.length > maxCharacters) break;
    sampled.push(message);
    characters += message.content.length;
  }
  return sampled;
}

export function buildStyleArtifact(messages: DwsMessageEvidence[], selfOpenDingTalkId: string) {
  const own = dedupeMessages(messages).filter((message) => !selfOpenDingTalkId || message.senderOpenDingTalkId === selfOpenDingTalkId);
  const samples = selectStyleSamples(own);
  const lengths = samples.map((item) => item.content.length).sort((a, b) => a - b);
  const countMatching = (pattern: RegExp) => samples.filter((item) => pattern.test(item.content)).length;
  return {
    evidence_type: "dingtalk_self_authored_style_corpus",
    source_policy: "Only messages authored by the profile owner may be used as voice/style evidence. Never imitate other senders.",
    statistics: {
      authored_messages_collected: own.length,
      samples_in_artifact: samples.length,
      conversations: new Set(own.map((item) => item.conversationId)).size,
      average_length: samples.length ? Math.round(samples.reduce((sum, item) => sum + item.content.length, 0) / samples.length) : 0,
      median_length: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0,
      question_ratio: ratio(countMatching(/[？?]/), samples.length),
      newline_ratio: ratio(countMatching(/\n/), samples.length),
      emoji_ratio: ratio(countMatching(/\p{Extended_Pictographic}/u), samples.length),
      exclamation_ratio: ratio(countMatching(/[！!]/), samples.length),
    },
    samples: samples.map(({ content, sentAt, conversationTitle, conversationType }) => ({ content, sentAt, conversationTitle, conversationType })),
  };
}

export function buildContextArtifact(messages: DwsMessageEvidence[], selfOpenDingTalkId: string, maxPairs = 180) {
  const unique = dedupeMessages(messages);
  const byConversation = new Map<string, DwsMessageEvidence[]>();
  for (const message of unique) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }
  const pairs: Array<{ incoming: string; reply: string; sentAt: string; conversationTitle: string; conversationType: string }> = [];
  const interlocutors = new Map<string, number>();
  for (const conversation of byConversation.values()) {
    conversation.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    for (let index = 0; index < conversation.length; index += 1) {
      const current = conversation[index];
      if (current.senderOpenDingTalkId !== selfOpenDingTalkId) {
        if (current.sender) interlocutors.set(current.sender, (interlocutors.get(current.sender) ?? 0) + 1);
        continue;
      }
      const previous = conversation[index - 1];
      if (!previous || previous.senderOpenDingTalkId === selfOpenDingTalkId) continue;
      if (current.content.length > 3_000 || previous.content.length > 3_000) continue;
      pairs.push({
        incoming: previous.content,
        reply: current.content,
        sentAt: current.sentAt,
        conversationTitle: current.conversationTitle,
        conversationType: current.conversationType,
      });
    }
  }
  const selectedPairs = pairs.slice(-maxPairs);
  return {
    evidence_type: "dingtalk_reply_context",
    source_policy: "incoming is context from another person; reply is the profile owner's real response. Only reply is voice evidence.",
    context_messages_collected: unique.length,
    reply_pairs: selectedPairs,
    frequent_interlocutors: [...interlocutors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, messagesCount]) => ({ name, messagesCount })),
  };
}

export function mergeMessageEvidence(...collections: DwsMessageEvidence[][]): DwsMessageEvidence[] {
  const merged = new Map<string, DwsMessageEvidence>();
  for (const message of collections.flat()) {
    const previous = merged.get(message.id);
    merged.set(message.id, previous ? {
      ...previous,
      ...message,
      mentionedMe: Boolean(previous.mentionedMe || message.mentionedMe),
      quotedMessage: message.quotedMessage ?? previous.quotedMessage,
    } : message);
  }
  return [...merged.values()];
}

export function buildQaArtifact(messages: DwsMessageEvidence[], selfOpenDingTalkId: string, maxPairs = 240) {
  const unique = mergeMessageEvidence(messages);
  const byConversation = new Map<string, DwsMessageEvidence[]>();
  for (const message of unique) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }

  const candidates: Array<{
    question: string;
    answer: string;
    askedBy: string;
    answeredAt: string;
    conversationTitle: string;
    conversationType: "single" | "group";
    trigger: "mention" | "private" | "quoted_reply";
  }> = [];
  let mentionQuestions = 0;
  let privateQuestions = 0;

  for (const conversation of byConversation.values()) {
    conversation.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    for (let index = 0; index < conversation.length; index += 1) {
      const incoming = conversation[index];
      if (incoming.senderOpenDingTalkId === selfOpenDingTalkId) {
        const quoted = incoming.quotedMessage;
        if (quoted?.content && quoted.senderOpenDingTalkId !== selfOpenDingTalkId) {
          candidates.push({
            question: quoted.content,
            answer: incoming.content,
            askedBy: quoted.sender,
            answeredAt: incoming.sentAt,
            conversationTitle: incoming.conversationTitle,
            conversationType: incoming.conversationType,
            trigger: "quoted_reply",
          });
        }
        continue;
      }

      const isPrivate = incoming.conversationType === "single";
      const isMention = Boolean(incoming.mentionedMe);
      if (!isPrivate && !isMention) continue;
      if (isPrivate) privateQuestions += 1;
      if (isMention) mentionQuestions += 1;

      const response = conversation.slice(index + 1, index + 7).find((message) => {
        if (message.senderOpenDingTalkId !== selfOpenDingTalkId) return false;
        const gap = parseDwsTimestamp(message.sentAt) - parseDwsTimestamp(incoming.sentAt);
        return !Number.isFinite(gap) || (gap >= 0 && gap <= 6 * 60 * 60 * 1000);
      });
      if (!response) continue;
      candidates.push({
        question: incoming.content,
        answer: response.content,
        askedBy: incoming.sender,
        answeredAt: response.sentAt,
        conversationTitle: incoming.conversationTitle,
        conversationType: incoming.conversationType,
        trigger: isPrivate ? "private" : "mention",
      });
    }
  }

  const seen = new Set<string>();
  const qaPairs = candidates.filter((pair) => {
    const key = `${pair.question}\u0000${pair.answer}`;
    if (seen.has(key) || pair.question.length > 4_000 || pair.answer.length > 4_000) return false;
    seen.add(key);
    return true;
  }).slice(-maxPairs);
  const scenarioSignals = new Map<string, typeof qaPairs>();
  for (const pair of qaPairs) {
    const intent = classifyQaIntent(pair.question, pair.answer);
    const list = scenarioSignals.get(intent) ?? [];
    if (list.length < 8) list.push(pair);
    scenarioSignals.set(intent, list);
  }

  return {
    evidence_type: "dingtalk_addressed_question_answer_playbook",
    source_policy: "Questions are messages sent in private chat, messages that @ the profile owner, or quoted messages. Answers are only the profile owner's real replies. Synthesize recurring patterns; never fabricate an answer that lacks evidence.",
    statistics: {
      mention_questions_collected: mentionQuestions,
      private_questions_collected: privateQuestions,
      qa_pairs: qaPairs.length,
      conversations: new Set(qaPairs.map((pair) => pair.conversationTitle)).size,
      distinct_scenario_signals: scenarioSignals.size,
    },
    scenario_signals: [...scenarioSignals.entries()].map(([intent, pairs]) => ({
      intent,
      evidence_count: qaPairs.filter((pair) => classifyQaIntent(pair.question, pair.answer) === intent).length,
      examples: pairs.map((pair) => ({ question: pair.question, answer: pair.answer, trigger: pair.trigger })),
    })),
    qa_pairs: qaPairs,
  };
}

function classifyQaIntent(question: string, answer: string): string {
  const text = `${question} ${answer}`;
  const rules: Array<[RegExp, string]> = [
    [/进度|现在.*情况|怎么样了|做到哪|完成了吗|什么时候|延期|交付/, "进度、交付与延期"],
    [/方案|建议|怎么做|选哪个|要不要|可不可以|是否|决定/, "方案判断与决策"],
    [/审批|申请|同意|批准|签字|权限/, "审批与授权"],
    [/风险|问题|异常|故障|影响|卡点|阻塞/, "风险、问题与升级"],
    [/需求|范围|优先级|排期|资源|人力/, "需求澄清与优先级"],
    [/反馈|评价|怎么看|合不合适|认可|不认可/, "反馈与评价"],
    [/会议|同步|对齐|拉群|沟通|协同|跟进/, "协同与沟通安排"],
    [/客户|合作方|供应商|外部|承诺|报价|合同/, "外部合作与承诺边界"],
    [/团队|同事|下属|汇报|负责人|谁来/, "团队分工与管理"],
    [/数据|指标|效果|验证|测试|复盘/, "数据验证与复盘"],
    [/不知道|不清楚|确认一下|查一下|核实/, "未知事实与核实"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? "其他真实工作问答";
}

export function normalizeDwsText(value: unknown): string {
  if (typeof value !== "string") return extractText(value).trim();
  const normalized = value.replace(/\r\n/g, "\n").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!normalized) return "";
  if ((normalized.startsWith("{") && normalized.endsWith("}")) || (normalized.startsWith("[") && normalized.endsWith("]"))) {
    try {
      const extracted = extractText(JSON.parse(normalized));
      if (extracted.trim()) return extracted.trim();
    } catch {
      // 普通文本恰好含花括号时保留原文。
    }
  }
  return normalized;
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => extractText(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  for (const key of ["text", "content", "title", "richText", "markdown"]) {
    const extracted = extractText(object[key], depth + 1);
    if (extracted) return extracted;
  }
  return "";
}

function dedupeMessages(messages: DwsMessageEvidence[]): DwsMessageEvidence[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function assertDwsSuccess(payload: Record<string, unknown>, action: string): void {
  if (payload.success !== false && !payload.errorCode) return;
  throw new Error(`${action}失败：${string(payload.errorMsg) || string(payload.errorCode) || "未知错误"}`);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function ratio(count: number, total: number): number {
  return total ? Number((count / total).toFixed(3)) : 0;
}

function parseDwsTimestamp(value: string): number {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}+08:00`).getTime();
}
