import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Archive, ArrowDown, ArrowLeftRight, BookOpen, Check, ChevronRight, CircleHelp,
  Cloud, Copy, Database, FileText, Flag, Gauge, History, LoaderCircle, LockKeyhole, LogOut,
  Menu, MessageSquare, MoreHorizontal, Paperclip, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck,
  Sparkles, ThumbsDown, Type, Wrench, X,
} from 'lucide-react';

import LoginScreen, { DEMO_PASSWORD, type User } from './LoginScreen';
import { SourceList, WebAnswer, type WebSource } from './WebSources';
import { DocumentAnswer, type DocumentSource } from './DocumentAnswer';
import { VoiceInput } from './VoiceInput';
import { PersonalMemorySettings } from './PersonalMemorySettings';
import { KnowledgeLibrary } from './KnowledgeLibrary';
import { ReusableMethods } from './ReusableMethods';
type Trace = { key: string; label: string; state: 'ok' | 'skip' | 'fail' | 'run'; detail: string };
type LearnTask = { group_id: string; state: 'queued' | 'running' | 'done' | 'failed'; alias_count: number; waiting_for_quota?: boolean };
type Meta = {
  message_id?: string;
  source?: string; group_id?: string; version_id?: string; matched_alias?: string; match_type?: string;
  score?: number; cloud_calls?: number; first_token_ms?: number; total_ms?: number; cost?: number;
  tokens_in?: number; tokens_out?: number; model?: string; trace?: Trace[]; query?: string;
  variant_styles?: string[]; variant_id?: string; variant_style?: string; variant_origin?: 'library' | 'cloud';
  learn_task?: LearnTask;
  group_scope?: string; group_owner_id?: string; group_can_manage?: boolean;
  personal_memory_command?: boolean;
  web_search?: boolean; web_sources?: WebSource[]; search_provider?: string; search_url?: string;
  knowledge?: boolean; requested_model?: string;
  document_id?: string; document_name?: string; document_sources?: DocumentSource[];
  image_id?: string; image_name?: string;
  reask_of?: { group_id: string; version_id: string }; error?: string; tool?: string; timezone?: string;
};
type Message = { id: string; role: 'user' | 'assistant'; content: string; source?: string; status?: string; meta?: Meta; error?: string };
type ChatDocument = { id: string; name: string; size: number };
type Session = { id: string; owner_id: string; title: string; scope: string; updated_at: string; last_source?: string; messages?: Message[]; documents?: ChatDocument[]; images?: ChatDocument[]; summary?: { content: string; updated_at: string } | null };
type Group = {
  id: string; owner_id: string; scope: string; original: string; intent: string; status: string;
  hits: number; version_count: number; alias_count: number; report_count: number; current_version_id: string;
  entities?: string[]; constraints?: string[]; aliases?: { id: string; text: string; status: string; reason?: string; source: string }[];
  versions?: { id: string; n: number; answer: string; basis: string; status: string; created_at: string; variants?: { id: string; style: string; text: string }[] }[];
  learn_task?: LearnTask | null;
  can_manage?: boolean;
  updated_at: string;
};
type Settings = {
  timezone: string; threshold: number; auto_learn: number; default_scope: string; max_context_turns: number;
  pause_threshold: number; pause_window_days: number; cloud_online: boolean; model: string; demo_mode: boolean;
  shared_member: boolean;
  font_scale: number;
  session_summary_enabled: number; personal_memory_enabled: number;
  search_provider?: string;
  text_models?: string[]; vision_model?: string;
  local_model?: string;
  models?: { id: string; label: string; kind: string; default: boolean; enabled: boolean; available: boolean }[];
  disabled_models?: string[];
  vision_available?: boolean; speech_available?: boolean;
};
type Quota = { limit: number | null; used: number; site_exhausted: boolean; resets_at: string };
type Usage = { total: number; zero_cloud: number; zero_cloud_rate: number; cloud_calls: number; answer_calls: number; learn_calls: number; summary_calls: number; cost: number; cost_configured: boolean; cost_per_100: number | null; median_total_ms: number; paths: Record<string, number>; requests: { at: string; query: string; path: string; cloud_calls: number; total_ms: number; cost: number }[]; quota: Quota };
type Governance = {
  reports: { id: string; group_id?: string; original: string; answer?: string; reporter: string; category: string; note: string; status: string; created_at: string }[];
  suspensions: { id: string; group_id: string; original: string; kind: string; reason: string; status: string; can_manage: boolean }[];
  revisions: { id: string; group_id: string; original: string; proposer: string; proposed_answer: string; note: string; status: string; can_manage: boolean }[];
  metrics: { open: number; suspended: number; pending_revisions: number };
};

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const starters = [
  { text: 'Python 3 的 `bool([])` 返回什么？为什么？', tag: '学习' },
  { text: 'Excel 怎么把两列文字合并成一列？', tag: '办公' },
  { text: '今天星期几？', tag: '本地工具' },
  { text: '解释一下 Python 的装饰器是怎么工作的', tag: '学习' },
  { text: '37 × 48 等于多少？', tag: '本地工具' },
  { text: '我没有独显，预算也有限。给我两个运行 AI 助手的方案', tag: '决策' },
  { text: '画一只骑自行车的鹈鹕', tag: '画图' },
  { text: 'Draw a pelican riding a bicycle', tag: '画图 · EN' },
];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = await response.json();
      message = typeof body.detail === 'string' ? body.detail : message;
    } catch { /* keep the status text */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function fmtDate(value?: string) {
  if (!value) return '刚刚';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function sourceName(source?: string) {
  return ({ library: '问答库', knowledge: '共享知识库', cloud: '云端生成', local_model: '本地模型', search: '网页搜索', document: '文件问答', image: '图片理解', tool: '本地工具', local: '本地澄清', error: '未完成' } as Record<string, string>)[source ?? ''] ?? '等待中';
}

function learningPending(task?: LearnTask | null) {
  return !task?.waiting_for_quota && (task?.state === 'queued' || task?.state === 'running');
}

function canPublishReask(meta: Meta, user: User) {
  return meta.group_can_manage ?? (meta.group_scope === 'personal' ? meta.group_owner_id === user.id : user.role === 'admin');
}

function learningLabel(task: LearnTask) {
  if (task.waiting_for_quota) return '原问已入库，额度重置后继续生成等价问法';
  if (task.state === 'done') return `已生成 ${task.alias_count} 条等价问法`;
  if (task.state === 'failed') return '原问已入库，等价问法生成失败';
  return '已入库，正在生成等价问法…';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [demoUsers, setDemoUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [openRegistration, setOpenRegistration] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [playLoginIntro, setPlayLoginIntro] = useState(true);
  const [page, setPage] = useState('chat');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [governance, setGovernance] = useState<Governance | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [filter, setFilter] = useState('all');
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [search, setSearch] = useState('');
  const [groupLimit, setGroupLimit] = useState(200);
  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [useKnowledge, setUseKnowledge] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [fileSelection, setFileSelection] = useState<{ sessionId: string; id: string; kind: 'images' | 'documents' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const workspaceEpoch = useRef(0);
  const [pageBusy, setPageBusy] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [error, setError] = useState('');
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [reportCategory, setReportCategory] = useState('mismatch');
  const [reportNote, setReportNote] = useState('');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSelection = fileSelection?.sessionId === session?.id ? fileSelection : null;
  const activeFile = activeSelection && session?.[activeSelection.kind]?.find((file) => file.id === activeSelection.id);
  const activeImage = activeSelection?.kind === 'images' ? activeFile : null;
  const activeDocument = activeSelection?.kind === 'documents' ? activeFile : null;

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  }, []);

  const refreshSessions = useCallback(async (preferred?: string) => {
    const list = await api<Session[]>('/api/sessions');
    setSessions(list);
    const wanted = preferred ?? session?.id;
    const next = list.find((item) => item.id === wanted) ?? list[0];
    if (next) {
      const full = await api<Session>(`/api/sessions/${next.id}`);
      setSession(full);
    } else {
      const scope = settings?.default_scope ?? 'personal';
      const created = await api<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ scope }) });
      setSession(created);
      setSessions([created]);
    }
  }, [session?.id, settings?.default_scope]);

  const loadPage = useCallback(async (target: string) => {
    if (!user) return;
    const epoch = workspaceEpoch.current;
    setPageBusy(true);
    setError('');
    try {
      if (target === 'library') {
        const data = await api<Group[]>(`/api/groups?filter=${filter}&q=${encodeURIComponent(search)}&limit=${groupLimit}`);
        if (epoch === workspaceEpoch.current) setGroups(data);
      } else if (target === 'governance') {
        const data = await api<Governance>('/api/governance');
        if (epoch === workspaceEpoch.current) setGovernance(data);
      } else if (target === 'usage') {
        const data = await api<Usage>('/api/usage?days=30');
        if (epoch === workspaceEpoch.current) setUsage(data);
      } else if (target === 'settings') {
        const data = await api<Settings>('/api/settings');
        if (epoch === workspaceEpoch.current) setSettings(data);
      }
    } catch (cause) {
      if (epoch === workspaceEpoch.current) setError(cause instanceof Error ? cause.message : '无法载入数据');
    } finally {
      if (epoch === workspaceEpoch.current) setPageBusy(false);
    }
  }, [filter, search, groupLimit, user]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const [users, options] = await Promise.all([
        api<{ id: string; name: string; role: string }[]>('/api/demo/users').catch(() => []),
        api<{ open_registration: boolean }>('/api/auth/options').catch(() => ({ open_registration: false })),
      ]);
      if (!active) return;
      setDemoUsers(users);
      setOpenRegistration(options.open_registration);
      try {
        const [me, configuration] = await Promise.all([
          api<{ user: User }>('/api/auth/me'),
          api<Settings>('/api/settings'),
        ]);
        if (!active) return;
        setUser(me.user);
        setSettings(configuration);
        await refreshSessions();
      } catch { /* The sign-in page is shown when the session needs authentication. */ }
      finally { if (active) setAuthReady(true); }
    };
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void loadPage(page);
  }, [loadPage, page]);

  useEffect(() => {
    if (!session?.id || page !== 'chat') return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [session?.messages?.length, page]);

  // 字体大小：整页按账号保存的百分比缩放，退出登录或读不到设置时回到 100%。
  useEffect(() => {
    const scale = settings?.font_scale && settings.font_scale >= 80 ? settings.font_scale : 100;
    document.documentElement.style.setProperty('--ui-zoom', String(scale / 100));
  }, [settings?.font_scale]);

  const sessionId = session?.id;
  useEffect(() => {
    if (!user || busy || uploading || page !== 'chat') return;
    let active = true;
    const syncFromServer = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const list = await api<Session[]>('/api/sessions');
        if (!active) return;
        setSessions(list);
        const target = list.find((item) => item.id === sessionId) ?? list[0];
        if (!target) return;
        const updated = await api<Session>(`/api/sessions/${target.id}`);
        if (active) setSession((current) => !current || current.id === sessionId ? updated : current);
      } catch { /* Retry the next time the tab becomes visible. */ }
    };
    document.addEventListener('visibilitychange', syncFromServer);
    return () => { active = false; document.removeEventListener('visibilitychange', syncFromServer); };
  }, [user, busy, uploading, page, sessionId]);
  const hasPendingLearning = session?.messages?.some((message) => learningPending(message.meta?.learn_task));
  useEffect(() => {
    if (page !== 'chat' || !sessionId || !hasPendingLearning) return;
    let active = true;
    let timer: number;
    const refresh = async () => {
      try {
        const updated = await api<Session>(`/api/sessions/${sessionId}`);
        if (!active) return;
        const results = new Map(updated.messages?.map((message) => [message.id, message.meta]));
        setSession((current) => current?.id === sessionId ? {
          ...current,
          messages: current.messages?.map((message) => {
            const meta = results.get(message.id);
            return meta?.learn_task ? { ...message, meta: { ...message.meta, learn_task: meta.learn_task, trace: meta.trace } } : message;
          }),
        } : current);
      } catch { /* Retry transient errors until the session changes. */ }
      if (active) timer = window.setTimeout(refresh, 1500);
    };
    timer = window.setTimeout(refresh, 1000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [page, sessionId, hasPendingLearning]);

  const pendingGroupId = learningPending(selectedGroup?.learn_task) ? selectedGroup?.id : undefined;
  useEffect(() => {
    if (page !== 'library' || !pendingGroupId) return;
    let active = true;
    let timer: number;
    const refresh = async () => {
      try {
        const updated = await api<Group>(`/api/groups/${pendingGroupId}`);
        if (!active) return;
        setSelectedGroup((current) => current?.id === pendingGroupId ? updated : current);
        if (!learningPending(updated.learn_task)) {
          const aliasCount = updated.aliases?.filter((alias) => alias.status === 'active').length;
          setGroups((current) => current.map((group) => group.id === pendingGroupId && aliasCount !== undefined
            ? { ...group, alias_count: aliasCount } : group));
          return;
        }
      } catch { /* Retry transient errors until the view changes. */ }
      if (active) timer = window.setTimeout(refresh, 1500);
    };
    timer = window.setTimeout(refresh, 1000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [page, pendingGroupId]);

  const enterWorkspace = async (nextUser: User) => {
    setPlayLoginIntro(false);
    setUser(nextUser);
    setError('');
    try {
      setSettings(await api<Settings>('/api/settings'));
      await refreshSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工作区加载失败');
    }
  };

  const clearWorkspace = () => {
    workspaceEpoch.current++;
    setPlayLoginIntro(false);
    setUser(null);
    setSession(null);
    setSessions([]);
    setGroups([]);
    setSelectedGroup(null);
    setGovernance(null);
    setSettings(null);
    setUsage(null);
    setInput('');
    setWebSearch(false);
    setUseKnowledge(false);
    setSelectedModel('');
    setFileSelection(null);
    setUploading(false);
    setReportTarget(null);
    setPage('chat');
  };

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      clearWorkspace();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '退出登录失败');
    }
  };

  const changeIdentity = async (nextId: string) => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      clearWorkspace();
      const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ user_id: nextId, password: DEMO_PASSWORD }) });
      setUser(result.user);
      setSettings(await api<Settings>('/api/settings'));
      await refreshSessions('');
      notify(`已切换到${result.user.name}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换身份失败');
    }
  };

  const newChat = async () => {
    try {
      const next = await api<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ scope: settings?.default_scope ?? 'personal' }) });
      setSession(next);
      setSessions((current) => [next, ...current]);
      setPage('chat');
      setInput('');
      inputRef.current?.focus();
    } catch (cause) { notify(cause instanceof Error ? cause.message : '创建会话失败'); }
  };

  const openSession = async (id: string) => {
    try { setSession(await api<Session>(`/api/sessions/${id}`)); setPage('chat'); setMobileNav(false); }
    catch (cause) { notify(cause instanceof Error ? cause.message : '打开会话失败'); }
  };

  const changeScope = async (scope: string) => {
    if (!session) return;
    try {
      const updated = await api<Session>(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ scope }) });
      setSession((previous) => previous ? { ...previous, ...updated, messages: previous.messages } : previous);
      notify(scope === 'shared' ? '本会话已加入共享学习' : '本会话仅保存到个人库');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '范围更新失败'); }
  };

  const uploadAttachment = async (file: File) => {
    if (!session || uploading || busy) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('文件大小不能超过 5 MB。');
      return;
    }
    const { id: sessionId } = session;
    const kind = /\.(png|jpe?g|webp)$/i.test(file.name) ? 'images' : 'documents';
    const epoch = workspaceEpoch.current;
    setUploading(true);
    setError('');
    try {
      const params = new URLSearchParams({ filename: file.name });
      const attachment = await api<ChatDocument>(`/api/sessions/${sessionId}/${kind}?${params}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      if (epoch !== workspaceEpoch.current) return;
      setSession((current) => current?.id === sessionId && !current[kind]?.some((item) => item.id === attachment.id)
        ? { ...current, [kind]: [...(current[kind] ?? []), attachment] } : current);
      setFileSelection({ sessionId, id: attachment.id, kind });
      setWebSearch(false);
      setUseKnowledge(false);
    } catch (cause) {
      if (epoch === workspaceEpoch.current) setError(cause instanceof Error ? cause.message : '上传失败');
    } finally {
      if (epoch === workspaceEpoch.current) setUploading(false);
    }
  };

  const send = async (rawText: string, forceCloud = false, reaskOf?: { group_id: string; version_id: string }, search = false,
    documentId?: string, imageId?: string, knowledge = false, model = selectedModel) => {
    const text = rawText.trim();
    if (!text || !session || busy || uploading) return;
    setBusy(true);
    setError('');
    const userId = `local-user-${crypto.randomUUID()}`;
    const assistantId = `pending-${crypto.randomUUID()}`;
    setSession((current) => current ? {
      ...current,
      messages: [...(current.messages ?? []),
        { id: userId, role: 'user', content: text, meta: imageId ? { image_id: imageId, image_name: session.images?.find((image) => image.id === imageId)?.name } : undefined },
        { id: assistantId, role: 'assistant', content: '', status: 'streaming', meta: { query: text, trace: [], web_search: search, document_id: documentId, image_id: imageId, knowledge, requested_model: model || undefined } },
      ],
    } : current);
    try {
      const response = await fetch(`${API_BASE}/api/sessions/${session.id}/messages`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, force_cloud: forceCloud, reask_of: reaskOf ?? null, web_search: search,
          document_id: documentId, image_id: imageId, knowledge, model: imageId ? undefined : model || undefined }),
      });
      if (!response.ok || !response.body) {
        let message = `请求失败（${response.status}）`;
        try { const body = await response.json(); message = body.detail || message; } catch { /* keep status */ }
        throw new Error(message);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = 'message';
      let completed = false;
      const handleBlock = (block: string) => {
        let dataText = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataText += line.slice(5).trim();
        }
        if (!dataText) return;
        const data = JSON.parse(dataText) as Record<string, unknown>;
        if (event === 'delta' && typeof data.text === 'string') {
          setSession((current) => current ? { ...current, messages: (current.messages ?? []).map((message) => message.id === assistantId ? { ...message, content: message.content + (data.text as string) } : message) } : current);
        }
        if (event === 'done') {
          completed = true;
          const meta = data as unknown as Meta;
          setSession((current) => current ? { ...current, messages: (current.messages ?? []).map((message) => message.id === assistantId ? { ...message, content: typeof data.content === 'string' ? data.content : message.content, id: meta.message_id ?? message.id, source: meta.source, status: 'done', meta } : message) } : current);
        }
        if (event === 'error') {
          completed = true;
          const message = String(data.message ?? '云端暂时不可用');
          setSession((current) => current ? { ...current, messages: (current.messages ?? []).map((item) => item.id === assistantId ? { ...item, id: String(data.message_id ?? item.id), status: 'error', source: 'error', error: message, meta: { query: text, reask_of: reaskOf, web_search: search, document_id: documentId, image_id: imageId, knowledge, requested_model: model || undefined } } : item) } : current);
        }
        event = 'message';
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        blocks.forEach(handleBlock);
      }
      if (buffer.trim()) handleBlock(buffer);
      if (!completed) throw new Error('连接中断，回答没有完成。');
      await refreshSessions(session.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '发送失败';
      setSession((current) => current ? { ...current, messages: (current.messages ?? []).map((item) => item.id === assistantId ? { ...item, status: 'error', source: 'error', error: message, meta: { query: text, reask_of: reaskOf, web_search: search, document_id: documentId, image_id: imageId, knowledge, requested_model: model || undefined } } : item) } : current);
      setError(message);
    } finally { setBusy(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || !session || busy || uploading) return;
    if (webSearch && [...input.trim()].length > 350) {
      setError('请将网页搜索问题缩短到 350 个字符以内');
      return;
    }
    setInput('');
    inputRef.current?.focus({ preventScroll: true });
    void send(input, false, undefined, webSearch && !activeFile, activeDocument?.id, activeImage?.id, useKnowledge && !activeFile);
  };
  const handleInputKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const report = async () => {
    if (!reportTarget) return;
    try {
      const result = await api<{ bypassed: boolean }>('/api/reports', { method: 'POST', body: JSON.stringify({ message_id: reportTarget.id, category: reportCategory, note: reportNote }) });
      setReportTarget(null); setReportNote('');
      notify(result.bypassed ? '反馈已记录，下次将绕开这条结果' : '反馈已记录，可在审核页查看');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '反馈提交失败'); }
  };

  const refreshGroupList = async () => {
    const result = await api<Group[]>(`/api/groups?filter=${filter}&q=${encodeURIComponent(search)}&limit=${groupLimit}`);
    setGroups(result);
  };

  const openGroup = async (group: Group) => {
    if (selectedGroup?.id === group.id) { setSelectedGroup(null); return; }
    try { setSelectedGroup(await api<Group>(`/api/groups/${group.id}`)); }
    catch (cause) { notify(cause instanceof Error ? cause.message : '无法打开记录'); }
  };

  const openLearnedGroup = async (id: string) => {
    try {
      const group = await api<Group>(`/api/groups/${id}`);
      setFilter('all');
      setSearch('');
      setSelectedGroup(group);
      setPage('library');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '无法打开问答'); }
  };

  const changeGroupState = async (group: Group, status: string) => {
    try {
      await api(`/api/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refreshGroupList();
      if (selectedGroup?.id === group.id) setSelectedGroup({ ...selectedGroup, status });
      notify(status === 'disabled' ? '记录已停用' : '记录已启用');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '更新失败'); }
  };

  const resolveSuspension = async (id: string, resolution: string) => {
    try {
      await api(`/api/suspensions/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) });
      setGovernance(await api<Governance>('/api/governance'));
      notify('审核结果已保存');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '操作失败'); }
  };

  const resolveRevision = async (id: string, action: string) => {
    try {
      await api(`/api/revisions/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action }) });
      setGovernance(await api<Governance>('/api/governance'));
      notify(action === 'publish' ? '修订已发布为新版本' : '建议已处理');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '操作失败'); }
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    try { setSettings(await api<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) })); notify('设置已保存'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : '设置保存失败'); }
  };

  const toggleModel = async (id: string, enabled: boolean) => {
    if (!settings) return;
    const current = settings.disabled_models ?? [];
    const next = enabled ? current.filter((name) => name !== id) : [...new Set([...current, id])];
    if (!enabled && selectedModel === id) setSelectedModel('');
    try {
      setSettings(await api<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ disabled_models: next }) }));
      notify(enabled ? '已启用模型' : '已停用模型');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '保存失败'); }
  };

  const pageTitle = ({ chat: '聊天', library: '问答库', knowledge: '共享知识库', methods: '复用方法', governance: '审核与治理', usage: '用量与成本', settings: '设置' } as Record<string, string>)[page] ?? '聊天';
  const activeTrace = useMemo(() => [...(session?.messages ?? [])].reverse().find((message) => message.role === 'assistant' && message.meta?.trace?.length)?.meta?.trace ?? [], [session?.messages]);

  if (!authReady) return <div className="login-loading" role="status" aria-label="正在检查会话" />;
  if (!user) {
    return <LoginScreen demoUsers={demoUsers} openRegistration={openRegistration} playIntro={playLoginIntro}
      authenticate={async (credentials) => {
        const path = credentials.name === undefined ? '/api/auth/login' : '/api/auth/register';
        const result = await api<{ user: User }>(path, { method: 'POST', body: JSON.stringify(credentials) });
        return result.user;
      }}
      onAuthenticated={(nextUser) => void enterWorkspace(nextUser)} />;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar--open' : ''}`}>
        <a className="brand" href="#chat" onClick={(event) => { event.preventDefault(); setPage('chat'); }}>
          <span className="brand-mark"><Sparkles size={19} /></span>
          <span><strong>柒柿AI</strong><small>通用助手</small></span>
        </a>
        <button className="new-chat" onClick={() => void newChat()}><Plus size={17} /><span>新建聊天</span><kbd>Ctrl K</kbd></button>
        <nav className="primary-nav" aria-label="主导航">
          <button className={page === 'chat' ? 'active' : ''} onClick={() => { setPage('chat'); setMobileNav(false); }}><MessageSquare size={17} /><span>聊天</span><small>{sessions.length || ''}</small></button>
          <button className={page === 'library' ? 'active' : ''} onClick={() => { setPage('library'); setMobileNav(false); }}><BookOpen size={17} /><span>问答库</span><small>{groups.length || ''}</small></button>
          {settings?.shared_member && <button className={page === 'knowledge' ? 'active' : ''} onClick={() => { setPage('knowledge'); setMobileNav(false); }}><FileText size={17} /><span>共享知识库</span></button>}
          <button className={page === 'methods' ? 'active' : ''} onClick={() => { setPage('methods'); setMobileNav(false); }}><Wrench size={17} /><span>复用方法</span></button>
          <button className={page === 'governance' ? 'active' : ''} onClick={() => { setPage('governance'); setMobileNav(false); }}><Flag size={17} /><span>审核</span><small>{(governance?.metrics.open ?? 0) || ''}</small></button>
          <button className={page === 'usage' ? 'active' : ''} onClick={() => { setPage('usage'); setMobileNav(false); }}><Gauge size={17} /><span>用量</span></button>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => { setPage('settings'); setMobileNav(false); }}><Settings2 size={17} /><span>设置</span></button>
        </nav>
        <div className="session-section">
          <div className="section-label"><span>最近会话</span><span>{sessions.length}</span></div>
          <div className="session-list">
            {sessions.map((item) => (
              <button key={item.id} className={`session-link ${item.id === session?.id && page === 'chat' ? 'selected' : ''}`} onClick={() => void openSession(item.id)}>
                <span className={`source-dot source-dot--${item.last_source ?? 'none'}`} />
                <span className="session-link__body"><span className="session-title">{item.title}</span><small>{fmtDate(item.updated_at)} · {item.scope === 'shared' ? '共享' : '个人'}</small></span>
              </button>
            ))}
            {!sessions.length && <p className="muted-text session-empty">会话还会保存在这里</p>}
          </div>
        </div>
        <div className="sidebar-foot">
          <div className="library-status"><span className={`status-led ${settings?.cloud_online ? 'online' : ''}`} /><span>{settings?.shared_member ? 'QS-2048 · 柒柿共享库' : '个人问答库'}</span><small>{settings?.cloud_online ? '云端已连接' : '本地模式'}</small></div>
          <div className="profile-row"><span className="avatar">{user.name.slice(-1)}</span><span className="profile-copy"><strong>{user.name}</strong><small>{settings?.shared_member ? (user.role === 'admin' ? '共享库管理员' : '共享库成员') : '个人工作区'}</small></span>
            <button className="icon-button" aria-label="退出登录" title="退出登录" disabled={busy} onClick={() => void logout()}><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="关闭导航" />}

      <main className={`main-area ${page === 'chat' && inspectorOpen ? 'main-area--inspector' : ''}`}>
        <header className="topbar">
          <div className="topbar-leading">
            <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={18} /></button>
            <div className="crumb"><span>柒柿AI</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div>
            {page === 'chat' && session && <div className="chat-context">
              <select aria-label="问答库范围" value={session.scope} onChange={(event) => void changeScope(event.target.value)}>
                <option value="personal">仅个人</option>{(settings?.shared_member || session.scope === 'shared') && <option value="shared" disabled={!settings?.shared_member}>共享学习</option>}
              </select>
              <span className="memory-chip"><History size={13} />近 {settings?.max_context_turns ?? 3} 轮记忆</span>
            </div>}
          </div>
          <div className="topbar-actions">
            <span className={`connection-pill ${settings?.cloud_online ? 'is-online' : ''}`}><span />{settings?.cloud_online ? settings.model : '本地可用'}</span>
            {demoUsers.length > 1 && demoUsers.some((demo) => demo.id === user.id) && <select className="identity-select" aria-label="切换演示身份" disabled={busy} value={user.id} onChange={(event) => void changeIdentity(event.target.value)}>
              {demoUsers.map((item) => <option key={item.id} value={item.id}>{item.name}{item.role === 'admin' ? ' · 管理员' : ''}</option>)}
            </select>}
            {page === 'chat' && <button className={`icon-button ${inspectorOpen ? 'pressed' : ''}`} onClick={() => setInspectorOpen((open) => !open)} title="切换请求追踪"><ArrowLeftRight size={17} /></button>}
          </div>
        </header>

        {error && <div className="global-error" role="status"><CircleHelp size={15} />{error}<button onClick={() => setError('')} aria-label="关闭"><X size={14} /></button></div>}

        {page === 'chat' && session && <div className="chat-layout">
          <section className="conversation-column">
            <div className="conversation-scroll" ref={scrollRef}>
              {session.messages?.length ? <div className="message-stack">
                  {session.messages.map((message) => <ChatMessage key={message.id} message={message} user={user} sessionId={session.id} busy={busy} onOpenGroup={openLearnedGroup} onCopy={() => { void navigator.clipboard.writeText(message.content); notify('已复制回答'); }} onReport={() => { setReportTarget(message); setReportCategory('mismatch'); setReportNote(''); }} onRetry={() => void send(message.meta?.query ?? '', false, undefined, Boolean(message.meta?.web_search), message.meta?.document_id, message.meta?.image_id, Boolean(message.meta?.knowledge), message.meta?.requested_model ?? '')} onReask={() => void send(message.meta?.query ?? '', true, message.meta?.reask_of ?? (message.meta?.group_id && message.meta?.version_id ? { group_id: message.meta.group_id, version_id: message.meta.version_id } : undefined), false, undefined, undefined, false, selectedModel === '@local' ? '' : selectedModel)} onVariant={async (style) => {
                  try {
                    const result = await api<{ message: Message; cloud_calls: number }>(`/api/sessions/${session.id}/messages/${message.id}/variant`, { method: 'POST', body: JSON.stringify({ style }) });
                    setSession((current) => current?.id === session.id ? {
                      ...current,
                      messages: current.messages?.map((item) => item.id === message.id
                        ? { ...result.message, meta: { ...result.message.meta, learn_task: item.meta?.learn_task, trace: item.meta?.trace } } : item),
                    } : current);
                    notify(result.cloud_calls ? '已生成新的表达' : '已切换表达');
                  } catch (cause) { notify(cause instanceof Error ? cause.message : '没有可用的表达变体'); }
                }} onPublish={async (answer) => {
                  const target = message.meta?.reask_of ?? (message.meta?.group_id && message.meta?.version_id ? { group_id: message.meta.group_id, version_id: message.meta.version_id } : undefined);
                  if (!target) return notify('找不到要修订的问题组');
                  try {
                    const { revision_id } = await api<{ revision_id: string }>('/api/revisions', { method: 'POST', body: JSON.stringify({ group_id: target.group_id, message_id: message.id, proposed_answer: answer, note: '由重新问云端的答复提交' }) });
                    if (message.meta && canPublishReask(message.meta, user)) {
                      await api(`/api/revisions/${revision_id}/resolve`, { method: 'POST', body: JSON.stringify({ action: 'publish' }) });
                      notify('新版本已发布');
                    } else {
                      notify('已提交修订建议');
                    }
                  } catch (cause) { notify(cause instanceof Error ? cause.message : '修订失败'); }
                }} />)}
                {busy && <div className="working-line"><LoaderCircle size={14} className="spin" />正在整理回答…</div>}
              </div> : <div className="welcome-state">
                <div className="welcome-symbol"><Sparkles size={22} /></div>
                <p className="eyebrow">柒柿AI · 通用助手</p>
                <h1>你好，{user.name}</h1>
                <p className="welcome-subtitle">你可以从问题、想法或正在处理的事情开始。</p>
                <div className="starter-grid">
                  {starters.map((item) => <button key={item.text} onClick={() => void send(item.text)}><span className="starter-tag">{item.tag}</span><span>{item.text}</span><ChevronRight size={15} /></button>)}
                </div>
              </div>}
            </div>
            <form className="composer" onSubmit={submit}>
              {(!!session.documents?.length || !!session.images?.length) && <div className="document-picker">
                <label htmlFor="chat-attachment">本次提问使用</label>
                <select id="chat-attachment" value={activeFile?.id ?? ''} disabled={busy || uploading} onChange={(event) => {
                  const id = event.target.value;
                  const kind = session.images?.some((image) => image.id === id) ? 'images' : 'documents';
                  setFileSelection(id ? { sessionId: session.id, id, kind } : null);
                  if (id) { setWebSearch(false); setUseKnowledge(false); setSelectedModel((model) => (model === '@none' ? '' : model)); }
                }}>
                  <option value="">不选附件</option>
                  {session.documents?.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                  {session.images?.map((file) => <option key={file.id} value={file.id}>{file.name}（图片）</option>)}
                </select>
                {activeDocument && <small>{selectedModel === '@local' || (!settings?.cloud_online && settings?.local_model)
                  ? '提问时由本地模型读取相关原文片段。' : '提问时会将相关原文片段发给云端模型。'}</small>}
                {activeImage && <small>提问时会将这张图片发给云端模型。</small>}
              </div>}
              <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleInputKey}
                placeholder={activeImage ? '根据所选图片提问…' : activeDocument ? '根据所选文件提问…' : useKnowledge ? '根据共享资料提问…' : webSearch ? '搜索网页并引用来源…' : '发消息给柒柿AI…'}
                rows={1} aria-label="输入问题" title="拖动右下角可以调整输入框高度" />
              <input ref={uploadRef} type="file" accept={'.pdf,.docx,.txt,.md,.csv' + (settings?.vision_available ? ',.png,.jpg,.jpeg,.webp' : '')} hidden onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void uploadAttachment(file);
              }} />
              <div className="composer-bottom">
                <div className="composer-tools">
                  <button className="attach-document" type="button" onClick={() => uploadRef.current?.click()} disabled={busy || uploading}
                    aria-label="上传文件" title="每个附件最多 5 MB">
                    {uploading ? <LoaderCircle size={13} className="spin" /> : <Paperclip size={13} />}
                    {uploading ? '正在读取' : '上传文件'}
                  </button>
                  <VoiceInput key={session.id} available={Boolean(settings?.speech_available)} disabled={busy || uploading}
                    transcribe={async (file) => (await api<{ text: string }>('/api/speech/transcribe', {
                      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: file,
                    })).text}
                    onText={(text) => {
                      setError('');
                      setInput((value) => value ? value + ' ' + text : text);
                      inputRef.current?.focus();
                    }}
                    onError={setError} />
                  <label title={activeFile ? '取消选择附件后可搜索网页' : '将本次问题发给' + (settings?.search_provider ?? '搜索服务') + '以获取来源'}
                    className={`search-toggle ${webSearch ? 'active' : ''}`}>
                    <input type="checkbox" checked={webSearch} disabled={Boolean(activeFile) || uploading}
                      onChange={(event) => {
                        setWebSearch(event.target.checked);
                        if (event.target.checked) {
                          setUseKnowledge(false);
                          if (selectedModel === '@local') setSelectedModel('');
                        }
                      }} />网页搜索
                  </label>
                  {settings?.shared_member && <label className={`search-toggle ${useKnowledge ? 'active' : ''}`}>
                    <input type="checkbox" checked={useKnowledge} disabled={Boolean(activeFile) || uploading}
                      onChange={(event) => {
                        setUseKnowledge(event.target.checked);
                        if (event.target.checked) setWebSearch(false);
                      }} />共享资料
                  </label>}
                  {(settings?.cloud_online || settings?.local_model) && <select className="composer-model" aria-label="回答模型"
                    value={activeImage ? '' : selectedModel} disabled={busy || Boolean(activeImage)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedModel(value);
                      if (value === '@none') { setWebSearch(false); setUseKnowledge(false); }
                    }}>
                    <option value="">{activeImage ? settings.vision_model || '图片模型' : '自动选择'}</option>
                    <option value="@none">不用模型 · 只查问答库</option>
                    {(settings.models ?? []).filter((model) => model.enabled && model.available && model.kind !== 'vision')
                      .map((model) => <option key={model.id} value={model.id} disabled={model.kind === 'local' && webSearch}>{model.label}</option>)}
                  </select>}
                </div>
                <span><kbd>Enter</kbd> 发送 · <kbd>Shift Enter</kbd> 换行</span>
                <button className="send-button" type="submit" disabled={!input.trim() || busy || uploading} aria-label="发送"><Send size={17} /></button>
              </div>
            </form>
          </section>
          {inspectorOpen && <aside className="inspector-panel">
            <div className="panel-heading"><div><span className="eyebrow">本次请求</span><h2>处理路径</h2></div><button className="icon-button" aria-label="关闭追踪" onClick={() => setInspectorOpen(false)}><X size={16} /></button></div>
            <div className="trace-list">
              {activeTrace.length ? activeTrace.map((step, index) => <div className={`trace-item trace-item--${step.state}`} key={`${step.key}-${index}`}>
                <span className="trace-marker">{step.state === 'ok' ? <Check size={12} /> : step.state === 'run' ? <LoaderCircle size={12} className="spin" /> : step.state === 'fail' ? <X size={12} /> : <span />}</span>
                <div><strong>{step.label}</strong><p>{step.detail}</p></div>
              </div>) : <div className="trace-empty"><ArrowDown size={17} /><span>发送消息后显示匹配、工具和云端调用路径</span></div>}
            </div>
            {Boolean(settings?.session_summary_enabled) && session.summary && <details className="session-summary">
              <summary><span>会话摘要</span><time dateTime={session.summary.updated_at}>{fmtDate(session.summary.updated_at)}</time></summary>
              <p>{session.summary.content}</p>
            </details>}
            <div className="inspector-divider" />
            {session.messages?.length ? <UsageSummary messages={session.messages} /> : <div className="mini-stat"><span>本会话云端调用</span><strong>0</strong></div>}
            <div className="inspector-foot"><ShieldCheck size={14} />匹配前先检查答案权限与适用条件</div>
          </aside>}
        </div>}

        {page === 'methods' && <ReusableMethods api={api} />}

        {page === 'knowledge' && settings?.shared_member && <KnowledgeLibrary api={api} onAsk={() => {
          setFileSelection(null);
          setWebSearch(false);
          setUseKnowledge(true);
          setPage('chat');
        }} />}

        {page === 'library' && <section className="page-content library-page">
          <div className="page-heading"><div><span className="eyebrow">可复用知识</span><h1>问答库</h1><p>管理原问、等价问法和已发布答案。</p></div><div className="page-heading-actions"><span className="count-label"><Database size={15} />{groups.length >= groupLimit ? `已显示 ${groups.length} 个问题组` : `${groups.length} 个问题组`}</span></div></div>
          <div className="toolbar-row">
            <div className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refreshGroupList(); }} placeholder="搜索问题或意图" /><kbd>↵</kbd></div>
            <div className="segmented-control" aria-label="筛选问答库"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>个人</button><button className={filter === 'shared' ? 'active' : ''} onClick={() => setFilter('shared')}>共享</button><button className={filter === 'disabled' ? 'active' : ''} onClick={() => setFilter('disabled')}>停用</button></div>
          </div>
          {pageBusy ? <LoadingLine /> : <div className="library-grid">
            <div className="group-list">
              {groups.map((group) => <button key={group.id} className={`group-row ${selectedGroup?.id === group.id ? 'active' : ''}`} onClick={() => void openGroup(group)}>
                <span className="group-icon"><FileText size={16} /></span><span className="group-main"><strong>{group.original}</strong><small>{group.intent}</small><span className="group-tags"><em className={group.scope === 'shared' ? 'tag-shared' : 'tag-personal'}>{group.scope === 'shared' ? '共享库' : '个人库'}</em><em>{group.alias_count} 条问法</em><em>{group.hits} 次命中</em></span></span><span className={`state-label state-label--${group.status}`}>{group.status === 'active' ? '启用中' : '已停用'}</span><ChevronRight size={16} className="row-chevron" />
              </button>)}
              {!groups.length && <div className="empty-state"><BookOpen size={22} /><strong>没有找到问答记录</strong><span>完整回答并开启学习后，合格问答会出现在这里。</span></div>}
              {groups.length >= groupLimit && <div className="group-list-more"><button className="outline-button" onClick={() => setGroupLimit((value) => value + 200)}>加载更多</button></div>}
            </div>
            <div className="detail-pane">
              {selectedGroup ? <GroupDetail group={selectedGroup} onToggle={() => void changeGroupState(selectedGroup, selectedGroup.status === 'active' ? 'disabled' : 'active')} onPublish={async (answer) => {
                try { await api(`/api/groups/${selectedGroup.id}/versions`, { method: 'POST', body: JSON.stringify({ answer, basis: '问答库编辑' }) }); setSelectedGroup(await api<Group>(`/api/groups/${selectedGroup.id}`)); await refreshGroupList(); notify('已发布新版本'); }
                catch (cause) { notify(cause instanceof Error ? cause.message : '发布失败'); }
              }} /> : <div className="detail-placeholder"><BookOpen size={20} /><span>选择一个问题组查看答案版本与等价问法</span></div>}
            </div>
          </div>}
        </section>}

        {page === 'governance' && <section className="page-content">
          <div className="page-heading"><div><span className="eyebrow">反馈与质量</span><h1>审核与治理</h1><p>核查用户反馈、暂停对象与共享库修订建议。</p></div><span className="role-note"><ShieldCheck size={15} />{user.role === 'admin' ? '共享库管理员' : '成员 · 只读处理'}</span></div>
          <div className="metric-strip"><Metric label="待处理反馈" value={governance?.metrics.open ?? 0} icon={<Flag size={17} />} /><Metric label="暂停对象" value={governance?.metrics.suspended ?? 0} icon={<Archive size={17} />} /><Metric label="修订建议" value={governance?.metrics.pending_revisions ?? 0} icon={<FileText size={17} />} /><Metric label="观察窗口" value={settings ? `${settings.pause_window_days} 天` : '—'} icon={<History size={17} />} /></div>
          {pageBusy ? <LoadingLine /> : <div className="governance-columns">
            <div className="data-section"><div className="data-section-head"><div><h2>反馈队列</h2><p>事实错误与错配反馈会为报告者绕开结果。</p></div><span className="quiet-count">{governance?.reports.length ?? 0}</span></div>
              {governance?.reports.length ? governance.reports.map((report) => <article className="governance-row" key={report.id}><div className="report-mark"><ThumbsDown size={15} /></div><div className="row-copy"><strong>{report.original}</strong><p><span className={`feedback-type feedback-type--${report.category}`}>{({ fact: '事实有误', mismatch: '答非所问', style: '表达反馈' } as Record<string, string>)[report.category] ?? report.category}</span>{report.note || '未填写补充说明'}</p><small>{report.reporter} · {fmtDate(report.created_at)}</small>{report.answer && <details><summary>查看所报告的答复</summary><div className="revision-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{report.answer}</ReactMarkdown></div></details>}</div><span className="state-label">{report.status === 'open' ? '待核查' : report.status === 'recorded' ? '已记录' : '已处理'}</span></article>) : <InlineEmpty text="暂时没有反馈" />}
            </div>
            <div className="data-section"><div className="data-section-head"><div><h2>暂停与修订</h2><p>修正答案会创建新版本，旧版本保留记录。</p></div><span className="quiet-count">{(governance?.suspensions.length ?? 0) + (governance?.revisions.length ?? 0)}</span></div>
              {governance?.suspensions.filter((item) => item.status === 'active').map((item) => <article className="governance-row" key={item.id}><div className="report-mark report-mark--warn"><LockKeyhole size={15} /></div><div className="row-copy"><strong>{item.original}</strong><p>{item.reason}</p><small>{item.kind === 'version' ? '答案版本暂停' : '问法匹配暂停'}</small></div>{item.can_manage && <div className="row-actions"><button className="small-button" onClick={() => void resolveSuspension(item.id, 'restored')}>恢复</button><button className="small-button small-button--accent" onClick={() => void resolveSuspension(item.id, 'disabled')}>停用</button></div>}</article>)}
              {governance?.revisions.filter((item) => item.status === 'pending').map((item) => <article className="governance-row revision-row" key={item.id}><div className="report-mark"><FileText size={15} /></div><div className="row-copy"><strong>{item.original}</strong><p>{item.note || '成员提交了答案修订建议'}</p><small>{item.proposer}</small><details><summary>查看建议答案</summary><div className="revision-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.proposed_answer}</ReactMarkdown></div></details></div>{item.can_manage && <div className="row-actions"><button className="small-button small-button--accent" onClick={() => void resolveRevision(item.id, 'publish')}>发布修正</button><button className="small-button" onClick={() => void resolveRevision(item.id, 'kept')}>保留原版</button></div>}</article>)}
              {!governance?.suspensions.some((item) => item.status === 'active') && !governance?.revisions.some((item) => item.status === 'pending') && <InlineEmpty text="没有待处理的暂停或修订" />}
            </div>
          </div>}
        </section>}

        {page === 'usage' && <section className="page-content">
          <div className="page-heading"><div><span className="eyebrow">最近 30 天</span><h1>用量与成本</h1><p>本地工具和问答库复用不会产生在线模型调用。</p></div><button className="outline-button" onClick={() => void loadPage('usage')}><RefreshCw size={15} />刷新</button></div>
          {usage && <>
            <div className="quota-banner" role="status">
              <strong>今日云端额度</strong>
              <span>{usage.quota.used}{usage.quota.limit ? ` / ${usage.quota.limit}` : ''} 次</span>
              {usage.quota.site_exhausted && <span>工作区额度已用完</span>}
              {(usage.quota.limit !== null || usage.quota.site_exhausted) && <small>{fmtDate(usage.quota.resets_at)} 重置</small>}
            </div>
            <div className="metric-strip usage-metrics">
              <Metric label="零云端调用" value={`${usage.zero_cloud}/${usage.total}`} foot={`${Math.round(usage.zero_cloud_rate * 100)}% 的请求`} icon={<Database size={17} />} />
              <Metric label="云端回答" value={usage.answer_calls} icon={<Cloud size={17} />} />
              <Metric label="后台改写" value={usage.learn_calls} foot={`会话摘要 ${usage.summary_calls ?? 0} 次`} icon={<Sparkles size={17} />} />
              <Metric label="总估算成本" value={usage.cost_configured ? `$${usage.cost.toFixed(4)}` : '未设置单价'}
                foot={usage.cost_configured && usage.cost_per_100 !== null ? `每百次请求约 $${usage.cost_per_100.toFixed(4)}` : undefined} icon={<Gauge size={17} />} />
              <Metric label="总耗时中位" value={`${usage.median_total_ms} ms`} icon={<History size={17} />} />
            </div>
            <div className="usage-layout"><div className="data-section path-section"><div className="data-section-head"><div><h2>请求路径</h2><p>按最近 30 天的请求记录统计。</p></div></div>{Object.keys(usage.paths).length ? Object.entries(usage.paths).sort((a, b) => b[1] - a[1]).map(([path, count]) => <div className="bar-row" key={path}><span>{({ exact: '原问命中', alias: '等价问法', semantic: '意图匹配', tool: '本地工具', method: '复用方法', local_model: '本地模型', cloud: '云端回答', search: '网页搜索', document: '文件问答', image: '图片理解', knowledge: '共享资料', learn: '后台改写', clarify: '澄清问题', revision: '发布修订' } as Record<string, string>)[path] ?? path}</span><div className="bar-track"><i style={{ width: `${Math.max(3, count / Math.max(...Object.values(usage.paths)) * 100)}%` }} /></div><strong>{count}</strong></div>) : <InlineEmpty text="还没有请求记录" />}</div>
              <div className="data-section cost-section"><div className="data-section-head"><div><h2>请求日志</h2><p>路径、调用次数与完成时间。</p></div><span className="quiet-count">{usage.requests.length}</span></div><div className="table-wrap"><table><thead><tr><th>时间</th><th>请求</th><th>路径</th><th>云端</th><th>耗时</th></tr></thead><tbody>{usage.requests.map((row, index) => <tr key={`${row.at}-${index}`}><td>{fmtDate(row.at)}</td><td className="query-cell">{row.query}</td><td><span className={`path-pill path-pill--${row.path}`}>{({ exact: '原问', alias: '改写', semantic: '意图', tool: '工具', method: '复用方法', local_model: '本地模型', cloud: '云端', search: '网页搜索', document: '文件问答', image: '图片理解', knowledge: '共享资料', learn: '改写', summary: '会话摘要' } as Record<string, string>)[row.path] ?? row.path}</span></td><td>{row.cloud_calls}</td><td>{row.total_ms} ms</td></tr>)}</tbody></table>{!usage.requests.length && <InlineEmpty text="暂无用量数据" />}</div></div>
            </div>
          </>}
        </section>}

        {page === 'settings' && settings && <section className="page-content settings-page">
          <div className="page-heading"><div><span className="eyebrow">偏好与路由</span><h1>设置</h1><p>配置本地工具、学习范围与回答匹配策略。</p></div><span className={`status-pill ${settings.cloud_online ? 'is-online' : ''}`}><span />{settings.cloud_online ? `已连接 · ${settings.model}` : '云端未配置'}</span></div>
          <div className="settings-layout">
            <div className="settings-main">
              <SettingsSection icon={<Type size={17} />} title="显示" description="字体大小按账号保存在服务端，登录后在每台设备上立即生效。">
                <label className="setting-row setting-row--range">
                  <span><strong>字体大小</strong><small>当前 {settings.font_scale}% · 整页一起放大，按钮和输入框也跟着变大</small></span>
                  <input aria-label="字体大小" type="range" min="80" max="150" step="5" value={settings.font_scale}
                    onChange={(event) => setSettings({ ...settings, font_scale: Number(event.target.value) })}
                    onMouseUp={() => void saveSettings({ font_scale: settings.font_scale })}
                    onTouchEnd={() => void saveSettings({ font_scale: settings.font_scale })}
                    onKeyUp={() => void saveSettings({ font_scale: settings.font_scale })} />
                </label>
                <div className="setting-row">
                  <span><strong>快速选择</strong><small>看不清时先试 115% 或 130%；130% 以上适合投影和外接屏。</small></span>
                  <span className="font-presets">{[100, 115, 130, 145].map((value) => (
                    <button key={value} type="button" className={settings.font_scale === value ? 'small-button small-button--accent' : 'small-button'}
                      onClick={() => void saveSettings({ font_scale: value })}>{value}%</button>
                  ))}</span>
                </div>
              </SettingsSection>
              <SettingsSection icon={<Cloud size={17} />} title="回答模型" description="自动选择会按下面的顺序使用第一个已启用的模型；停用的模型不参与自动选择，也不出现在聊天选择框里。">
                {(settings.models ?? []).length > 0 ? (settings.models ?? []).map((model) => (
                  <label className="setting-row" key={model.id}>
                    <span><strong>{model.label}{model.default ? ' · 默认' : ''}</strong><small>{model.kind === 'local' ? '本机 llama.cpp 接口，不消耗云端额度。' : model.available ? '云端模型。' : '云端未配置，暂时不可用。'}</small></span>
                    <input aria-label={`启用 ${model.label}`} className="toggle" type="checkbox" checked={model.enabled} onChange={(event) => void toggleModel(model.id, event.target.checked)} />
                  </label>
                )) : <div className="setting-row"><span><strong>还没有可选的模型</strong><small>服务端配置 CLOUD_BASE_URL、CLOUD_API_KEY 和 CLOUD_MODEL 后可以在这里启用或停用。</small></span></div>}
                <label className="setting-row"><span><strong>默认选择</strong><small>聊天里留空即自动选择；也可以选「不用模型」，只查问答库和本地工具。</small></span><span className="status-pill"><span />{settings.models?.find((model) => model.default && model.enabled)?.label ?? '按顺序顺延'}</span></label>
              </SettingsSection>
              <SettingsSection icon={<Wrench size={17} />} title="本地处理" description="日期与算术请求在本机计算。">
                <label className="setting-row"><span><strong>时区</strong><small>用于今天、日期和当前时间的计算。</small></span><select value={settings.timezone} onChange={(event) => void saveSettings({ timezone: event.target.value })}><option>Asia/Shanghai</option><option>Asia/Tokyo</option><option>UTC</option><option>Europe/London</option><option>America/New_York</option></select></label>
                <div className="setting-row"><span><strong>工具状态</strong><small>本地工具不消耗云端调用。</small></span><button className="outline-button" onClick={() => void send('今天星期几？')}><Wrench size={14} />试算今天</button></div>
              </SettingsSection>
              <SettingsSection icon={<BookOpen size={17} />} title="问答学习" description="选择回答后是否创建个人或共享问答。">
                <label className="setting-row"><span><strong>新会话默认范围</strong><small>共享会话的合格问答会进入柒柿共享库。</small></span><select value={settings.default_scope} onChange={(event) => void saveSettings({ default_scope: event.target.value })}><option value="personal">个人库</option>{settings.shared_member && <option value="shared">共享库</option>}</select></label>
                <label className="setting-row"><span><strong>自动学习</strong><small>独立、稳定的问答完成后自动入库，后台生成等价问法。</small></span><input className="toggle" type="checkbox" checked={Boolean(settings.auto_learn)} onChange={(event) => void saveSettings({ auto_learn: event.target.checked ? 1 : 0 } as Partial<Settings>)} /></label>
              </SettingsSection>
              <SettingsSection icon={<Search size={17} />} title="匹配与记忆" description="提高阈值会减少误复用，但更多问题会交给云端。">
                <label className="setting-row setting-row--range"><span><strong>意图匹配门槛</strong><small>当前 {settings.threshold.toFixed(2)}</small></span><input type="range" min="0.5" max="0.95" step="0.01" value={settings.threshold} onChange={(event) => setSettings({ ...settings, threshold: Number(event.target.value) })} onMouseUp={() => void saveSettings({ threshold: settings.threshold })} onTouchEnd={() => void saveSettings({ threshold: settings.threshold })} /></label>
                <label className="setting-row"><span><strong>会话记忆</strong><small>追问会带入近期原文，较早内容可整理为摘要。</small></span><select value={settings.max_context_turns} onChange={(event) => void saveSettings({ max_context_turns: Number(event.target.value) })}><option value="1">1 轮</option><option value="2">2 轮</option><option value="3">3 轮</option><option value="5">5 轮</option></select></label>
                <label className="setting-row"><span><strong>长对话摘要</strong><small>生成摘要会使用云端额度。</small></span><input aria-label="长对话摘要" className="toggle" type="checkbox" checked={Boolean(settings.session_summary_enabled)} onChange={(event) => void saveSettings({ session_summary_enabled: Number(event.target.checked) })} /></label>
                <label className="setting-row"><span><strong>跨会话个人记忆</strong><small>相关问题可将你保存的记忆交给云端模型。也可在聊天中发送「记住：内容」。</small></span><input aria-label="跨会话个人记忆" className="toggle" type="checkbox" checked={Boolean(settings.personal_memory_enabled)} onChange={(event) => void saveSettings({ personal_memory_enabled: Number(event.target.checked) })} /></label>
                <PersonalMemorySettings key={user.id} enabled={Boolean(settings.personal_memory_enabled)} request={api} />
              </SettingsSection>
            </div>
            <aside className="settings-aside"><div className="connection-card"><div className={`connection-icon ${settings.cloud_online ? 'connected' : ''}`}><Cloud size={19} /></div><strong>{settings.cloud_online ? '云端模型可用' : '云端模型尚未连接'}</strong><p>{settings.cloud_online ? `当前模型：${settings.model}` : '在服务端配置模型地址、密钥和模型名称后，未命中的问题可以交给云端。'}</p><div className="connection-meta"><span>API 密钥</span><strong>{settings.cloud_online ? '已在服务端配置' : '未配置'}</strong></div><div className="connection-meta"><span>服务模式</span><strong>{settings.demo_mode ? '演示身份' : '正式身份'}</strong></div></div><div className="policy-note"><ShieldCheck size={16} /><p>会话与问答数据保存在本机 SQLite。问答库检索只查询当前身份有权访问的记录。</p></div></aside>
          </div>
        </section>}
      </main>

      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
      {reportTarget && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportTarget(null); }}><form className="report-modal" onSubmit={(event) => { event.preventDefault(); void report(); }}><div className="modal-head"><div><span className="eyebrow">回答反馈</span><h2>报告问题</h2></div><button type="button" className="icon-button" onClick={() => setReportTarget(null)} aria-label="关闭"><X size={17} /></button></div><p className="modal-target">{reportTarget.content.slice(0, 200)}</p><label className="field-label">反馈类型<select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)}><option value="mismatch">答非所问</option><option value="fact">事实有误</option><option value="style">表达不合适</option></select></label><label className="field-label">补充说明<textarea value={reportNote} onChange={(event) => setReportNote(event.target.value)} placeholder="哪些条件或结论不适用？" rows={3} /></label><div className="modal-actions"><button className="outline-button" type="button" onClick={() => setReportTarget(null)}>取消</button><button className="primary-button" type="submit">提交反馈</button></div></form></div>}
    </div>
  );
}

function ChatMessage({ message, user, sessionId, busy, onOpenGroup, onCopy, onReport, onRetry, onReask, onVariant, onPublish }: {
  message: Message; user: User; sessionId: string; busy: boolean; onOpenGroup: (id: string) => void; onCopy: () => void; onReport: () => void; onRetry: () => void; onReask: () => void; onVariant: (style: string) => Promise<void>; onPublish: (answer: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  if (message.role === 'user') return <article className="user-message"><div className="user-message__identity">{user.name.slice(-1)}</div><div className="user-message__content">
    {message.meta?.image_id && <img className="chat-image" loading="lazy" alt={message.meta.image_name || '本次提问的图片'}
      src={`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(message.meta.image_id)}`} />}
    {message.content}</div></article>;
  const meta = message.meta ?? {};
  const isError = message.status === 'error' || message.source === 'error';
  const canReport = !meta.knowledge && (message.source === 'library' || message.source === 'cloud');
  const learningSkip = message.source === 'cloud' && meta.trace?.find((step) => step.key === 'learn' && step.state === 'skip')?.detail;
  const switchStyle = async (style: string) => {
    setRewriting(true);
    try { await onVariant(style); }
    finally { setRewriting(false); }
  };
  return <article className={`assistant-message ${isError ? 'assistant-message--error' : ''}`}>
    <div className="assistant-mark"><Sparkles size={15} /></div><div className="assistant-body">
      <div className="assistant-meta"><strong>柒柿AI</strong><span className={`source-pill source-pill--${message.source ?? 'pending'}`}><i />{sourceName(meta.knowledge && !isError ? 'knowledge' : meta.image_id && !isError ? 'image' : meta.document_id && !isError ? 'document' : meta.web_search && !isError ? 'search' : message.source)}</span>{meta.match_type && meta.source === 'library' && <span className="match-hint">{meta.match_type === 'semantic' ? '意图匹配' : meta.match_type === 'alias' ? '等价问法' : '原问命中'}</span>}</div>
      {isError ? <div className="error-answer"><CircleHelp size={16} /><span>{message.error || meta.error || '这次请求没有完成。'}</span><button onClick={onRetry} disabled={busy}><RefreshCw size={14} />重试</button></div> : <div className={`markdown-body ${message.status === 'streaming' ? 'markdown-body--streaming' : ''}`}>
        {message.content ? (meta.personal_memory_command ? <p className="personal-memory-content">{message.content}</p> : meta.document_id || meta.knowledge ? <DocumentAnswer content={message.content} sources={meta.document_sources ?? []} name={meta.document_name} /> : meta.web_search ? <WebAnswer content={message.content} sources={meta.web_sources ?? []} /> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>) : message.status === 'streaming' ? <span className="typing-cursor" /> : <span className="muted-text">没有生成文字</span>}
      </div>}
      {!isError && message.status !== 'streaming' && <div className="message-actions">
        <button onClick={() => { onCopy(); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }} title="复制回答">{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? '已复制' : '复制'}</span></button>
        {message.source === 'library' && <button onClick={onReask} disabled={busy}><RefreshCw size={14} /><span>重新问云端</span></button>}
        {canReport && !meta.web_search && !meta.document_id && !meta.image_id && <label className="variant-picker">
          {rewriting ? <LoaderCircle size={13} className="spin" /> : <ArrowLeftRight size={13} />}
          <select aria-label="换个说法" value="" disabled={rewriting} onChange={(event) => { if (event.target.value) void switchStyle(event.target.value); }}>
            <option value="">{rewriting ? '正在改写…' : '换个说法'}</option>
            <option value="brief">更简短</option><option value="detailed">更详细</option><option value="example">用例子解释</option>
            {meta.variant_style && meta.variant_style !== 'standard' && <option value="standard">恢复原回答</option>}
          </select>
        </label>}
        {canReport && <button onClick={onReport} disabled={rewriting}><Flag size={14} /><span>报告误答</span></button>}
        {message.source === 'cloud' && meta.reask_of && (!meta.variant_style || meta.variant_style === 'standard') && <button onClick={() => onPublish(message.content)}><Check size={14} /><span>{canPublishReask(meta, user) ? '发布新版本' : '建议修订'}</span></button>}
        <details className="answer-source"><summary><CircleHelp size={14} /><span>来源</span></summary><div className="source-popover"><strong>{sourceName(message.source)}</strong><p>{meta.group_id ? `问题组 ${meta.group_id}${meta.version_id ? ` · ${meta.version_id}` : ''}` : meta.model ? `模型 ${meta.model}` : meta.tool === 'date' ? `按 ${meta.timezone} 计算` : meta.tool === 'calculator' ? '本地安全计算器' : '当前会话回答'}</p>{meta.matched_alias && <small>命中问法：{meta.matched_alias}</small>}<small>本次云端调用：{meta.cloud_calls ?? 0} · 总耗时：{meta.total_ms ?? 0} ms</small></div></details>
      </div>}
      {meta.learn_task ? <div className="answer-learning">
        <span role="status">{learningLabel(meta.learn_task)}</span>
        <button className="text-button" onClick={() => onOpenGroup(meta.learn_task!.group_id)}>查看{meta.group_scope === 'shared' ? '共享' : '个人'}问答</button>
      </div> : learningSkip && <div className="answer-learning">未入库 · {learningSkip}</div>}
      {!isError && meta.web_search && meta.web_sources?.length ? <SourceList sources={meta.web_sources} provider={meta.search_provider} /> : null}
      {meta.search_url?.startsWith('https://www.baidu.com/s?') && <div className="web-sources">
        <a href={meta.search_url} target="_blank" rel="noopener noreferrer">在百度查看结果</a>
      </div>}
      {message.status === 'streaming' && <div className="streaming-caption"><LoaderCircle size={12} className="spin" />正在生成</div>}
    </div>
  </article>;
}

function UsageSummary({ messages }: { messages: Message[] }) {
  const assistant = messages.filter((message) => message.role === 'assistant');
  const cloud = assistant.reduce((sum, message) => sum + (message.meta?.cloud_calls ?? 0), 0);
  const reuse = assistant.filter((message) => message.source === 'library').length;
  const latest = [...assistant].reverse().find((message) => message.meta?.total_ms !== undefined);
  return <div className="mini-usage"><div><span>已回答</span><strong>{assistant.filter((message) => message.status !== 'streaming').length}</strong></div><div><span>库内复用</span><strong>{reuse}</strong></div><div><span>云端调用</span><strong>{cloud}</strong></div>{latest && <small>最近完成 · {latest.meta?.total_ms} ms</small>}</div>;
}

function GroupDetail({ group, onToggle, onPublish }: { group: Group; onToggle: () => void; onPublish: (answer: string) => void }) {
  const [editing, setEditing] = useState(false);
  const current = group.versions?.find((version) => version.id === group.current_version_id) ?? group.versions?.[0];
  const [answer, setAnswer] = useState(current?.answer ?? '');
  useEffect(() => { setAnswer(current?.answer ?? ''); setEditing(false); }, [group.id, current?.id]);
  const canManage = Boolean(group.can_manage);
  return <div className="group-detail">
    <div className="detail-head"><div><span className="eyebrow">{group.scope === 'shared' ? '共享问答组' : '个人问答组'}</span><h2>{group.original}</h2></div><button className="icon-button" title="更多操作"><MoreHorizontal size={18} /></button></div>
    <p className="detail-intent">{group.intent}</p>
    <div className="detail-stats"><div><span>当前版本</span><strong>{current ? `v${current.n}` : '—'}</strong></div><div><span>命中次数</span><strong>{group.hits}</strong></div><div><span>等价问法</span><strong>{group.aliases?.filter((alias) => alias.status === 'active').length ?? 0}</strong></div><div><span>最后更新</span><strong>{fmtDate(group.updated_at)}</strong></div></div>
    <div className="detail-block"><div className="block-title"><h3>当前答案</h3>{canManage && !editing && <button className="text-button" onClick={() => setEditing(true)}>编辑答案</button>}</div>
      {editing ? <><textarea className="answer-editor" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={9} /><div className="editor-actions"><button className="outline-button" onClick={() => { setAnswer(current?.answer ?? ''); setEditing(false); }}>取消</button><button className="primary-button" onClick={() => { onPublish(answer); setEditing(false); }}>发布为新版本</button></div></> : <div className="answer-preview markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{current?.answer ?? '暂无已发布答案'}</ReactMarkdown></div>}
    </div>
    <div className="detail-block"><div className="block-title"><h3>等价问法</h3><span className="quiet-count">{group.aliases?.length ?? 0}</span></div>{group.learn_task && <div className="answer-learning" role="status">{learningLabel(group.learn_task)}</div>}<div className="alias-list">{group.aliases?.map((alias) => <div className="alias-row" key={alias.id}><span className="alias-dot" /><span>{alias.text}</span><small>{alias.status === 'active' ? alias.source === 'original' ? '原问' : alias.source === 'seed' ? '已收录' : alias.source === 'generated' ? '自动生成' : '真实问法' : alias.reason ?? '未通过'}</small></div>)}</div></div>
    <div className="detail-block"><div className="block-title"><h3>答案版本</h3>{canManage && <button className="text-button" onClick={onToggle}>{group.status === 'active' ? '停用问答组' : '启用问答组'}</button>}</div><div className="version-list">{group.versions?.map((version) => <div className="version-row" key={version.id}><span className={`version-dot ${version.status === 'published' ? 'current' : ''}`} /><div><strong>v{version.n} · {version.status === 'published' ? '当前发布' : '历史版本'}</strong><small>{version.basis} · {fmtDate(version.created_at)}</small></div><span>{version.id === group.current_version_id ? '当前' : '留档'}</span></div>)}</div></div>
    <div className="detail-footer"><span><ShieldCheck size={14} />仅当前发布版本参与检索</span><span>{group.entities?.join(' · ')}</span></div>
  </div>;
}

function Metric({ label, value, foot, icon }: { label: string; value: string | number; foot?: string; icon: React.ReactNode }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong>{foot && <small>{foot}</small>}</div>;
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-section"><div className="settings-section-head"><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="settings-fields">{children}</div></section>;
}

function LoadingLine() { return <div className="loading-line"><LoaderCircle size={16} className="spin" />正在读取…</div>; }
function InlineEmpty({ text }: { text: string }) { return <div className="inline-empty"><span />{text}</div>; }

export default App;
