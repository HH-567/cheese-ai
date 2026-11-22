import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './login-intro.css';
import './login.css';

export type User = { id: string; name: string; role: string; verified: boolean };
type Credentials = { user_id: string; password: string; name?: string; remember: boolean };
type DemoUser = Pick<User, 'id' | 'name' | 'role'>;
type Gate = {
  card: HTMLDivElement;
  btn: HTMLButtonElement;
  btnZh: HTMLElement;
  btnEn: HTMLElement;
  hint: HTMLElement;
};

declare global {
  interface Window {
    __QISHI_ASSET_BASE__?: string;
    __QISHI_LOGIN__?: {
      mount: (gate: Gate) => void;
      wait: (context: { resolve: () => void }) => void;
    };
    __DSH_STARTUP__?: Record<string, string | boolean | number>;
    __DSH_STARTUP_API__?: { skip: () => void };
    __DSH_STARTUP_LOADED__?: boolean;
  }
}

const base = `${import.meta.env.BASE_URL}login-intro`;
export const DEMO_PASSWORD = 'demo1234';

export default function LoginScreen({ demoUsers, openRegistration, playIntro, authenticate, onAuthenticated }: {
  demoUsers: DemoUser[];
  openRegistration: boolean;
  playIntro: boolean;
  authenticate: (credentials: Credentials) => Promise<User>;
  onAuthenticated: (user: User) => void;
}) {
  const [showIntro, setShowIntro] = useState(() => playIntro
    && !window.matchMedia('(max-width: 760px), (max-height: 640px), (prefers-reduced-motion: reduce)').matches
    && new URLSearchParams(location.search).get('skipintro') !== '1');
  const [gate, setGate] = useState<Gate>();
  const [registering, setRegistering] = useState(false);
  const useDemoPicker = demoUsers.length > 0 && !openRegistration;
  const demoAccount = demoUsers.find((user) => user.role === 'admin') ?? demoUsers[0];
  const [account, setAccount] = useState(useDemoPicker ? demoUsers[0].id : '');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<{ user: User; at: Date }>();
  const [error, setError] = useState('');
  const [errorVersion, setErrorVersion] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef<User | undefined>(undefined);
  const resolveGate = useRef<(() => void) | undefined>(undefined);
  const playing = useRef(showIntro);
  const signingIn = useRef(false);
  const complete = useRef(onAuthenticated);
  complete.current = onAuthenticated;
  const fieldId = useId();

  useEffect(() => {
    if (!showIntro || !holder.current) return;
    const root = document.createElement('div');
    root.id = 'dsh-startup-root';
    root.className = 'dsu-root dsu-boot';
    const host = holder.current;
    host.append(root);
    const script = document.createElement('script');
    script.src = `${base}/splash.js?v=7`;

    const reveal = () => {
      if (!playing.current) return;
      playing.current = false;
      setShowIntro(false);
      setGate(undefined);
      if (confirmed.current) complete.current(confirmed.current);
    };
    window.__QISHI_ASSET_BASE__ = `${base}/assets`;
    const muted = new URLSearchParams(location.search).get('nosound') === '1';
    window.__DSH_STARTUP__ = {
      enabled: true, mode: 'always', theme: 'light', requireInteraction: true, allowSkip: true,
      openingSweep: false, waitForSoundGesture: true, diagnostics: false, sound: !muted, soundVolume: 0.5, sfx: 'audio',
      voice: !muted, voiceLang: 'en', voiceSource: 'asset', voicePack: 'f', voiceCue: true, welcomeDelay: 1500,
      identity: 'OPERATOR', identityId: '0000', accessLevel: '—',
      brand1: 'CHEESE', brand2: 'ACCESS CONTROL', brand3a: 'ACCESS', brand3b: 'GATE',
      orgZh: '柒柿 AI', orgEn: 'CHEESE AI', orgSub: 'CHEESE AI ACCESS GATE', welcomeBox: 'CHEESE AI',
      welcomeLabel: 'C H E E S E  ·  A I', logoLabel: 'C H E E S E', footer: 'POWERED BY CHEESE AI',
      accent: '#ff7500', transitionIn: 'dissolve', transitionJoin: 'dissolve', transitionOut: 'dissolve',
    };
    window.__QISHI_LOGIN__ = {
      mount: (view) => {
        view.card.classList.add('login-gate-card');
        view.btn.addEventListener('click', (event) => {
          event.preventDefault();
          if (view.btn.disabled) return;
          form.current?.requestSubmit();
        });
        setGate(view);
      },
      wait: ({ resolve }) => { resolveGate.current = resolve; },
    };
    script.onerror = reveal;
    script.onload = () => { if (!window.__DSH_STARTUP_API__) reveal(); };
    window.addEventListener('dsh-startup:done', reveal);
    host.append(script);

    return () => {
      window.removeEventListener('dsh-startup:done', reveal);
      window.__DSH_STARTUP_API__?.skip();
      delete window.__DSH_STARTUP_API__;
      delete window.__DSH_STARTUP_LOADED__;
      delete window.__QISHI_LOGIN__;
      delete window.__QISHI_ASSET_BASE__;
      delete window.__DSH_STARTUP__;
      root.remove();
      script.remove();
    };
  }, [showIntro]);

  useEffect(() => {
    if (!gate) return;
    gate.btn.disabled = busy || Boolean(verified);
    gate.btnZh.textContent = verified ? '已核验' : busy ? '核验中…' : registering ? '登记身份' : '验证身份';
    gate.btnEn.textContent = verified ? 'VERIFIED' : registering ? 'REGISTER' : 'VERIFY IDENTITY';
    gate.hint.textContent = verified ? '会话已建立，正在载入工作区…' : '输入身份资料后按 Enter 继续';
    gate.btn.classList.toggle('qishi-btn--done', Boolean(verified));
    gate.card.classList.toggle('qishi-card--done', Boolean(verified));
  }, [gate, busy, registering, verified]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (signingIn.current || confirmed.current) return;
    if (registering && password !== confirmation) {
      setError('两次输入的口令不一致。');
      setErrorVersion((version) => version + 1);
      return;
    }
    signingIn.current = true;
    setBusy(true);
    setError('');
    try {
      const user = await authenticate({
        user_id: account,
        password,
        remember,
        ...(registering ? { name: nickname } : {}),
      });
      confirmed.current = user;
      setPassword('');
      setConfirmation('');
      if (!playing.current) {
        complete.current(user);
        return;
      }
      const welcome = holder.current?.querySelector('.dsu-w4');
      const identity = holder.current?.querySelector('.dsu-idline');
      if (welcome) welcome.textContent = `欢迎 ${user.name} 访问`;
      if (identity) identity.textContent = `· ID CONFIRMED : ${user.id}`;
      setVerified({ user, at: new Date() });
      window.setTimeout(() => { if (playing.current) resolveGate.current?.(); }, 1200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '核验失败，请重试。');
      setErrorVersion((version) => version + 1);
    } finally {
      signingIn.current = false;
      setBusy(false);
    }
  };

  const label = (suffix: string, zh: string, en: string) =>
    <label className="qishi-label" htmlFor={`${fieldId}-${suffix}`}>
      <span className="qishi-label-zh">{zh}</span><i className="qishi-label-en" aria-hidden="true">{en}</i>
    </label>;

  const fields = <form ref={form} className={`qishi-form ${busy ? 'is-busy' : ''}`} onSubmit={submit} aria-label="身份核验">
    <div className="qishi-row">
      {label('account', '身份名称', 'IDENTITY')}
      {useDemoPicker ? <select className="qishi-input" id={`${fieldId}-account`} name="username" value={account} disabled={busy} onChange={(event) => setAccount(event.target.value)}>
        {demoUsers.map((demo) => <option key={demo.id} value={demo.id}>{demo.name}{demo.role === 'admin' ? ' · 管理员' : ''}</option>)}
      </select> : <input className="qishi-input" id={`${fieldId}-account`} name="username" autoComplete="username" value={account}
        disabled={busy} onChange={(event) => setAccount(event.target.value)} placeholder="ACCOUNT" maxLength={registering ? 32 : 80} required />}
    </div>
    <div className="qishi-row">
      {label('pass', '访问口令', 'PASSCODE')}
      <div className="qishi-passwrap">
        <input className="qishi-input" id={`${fieldId}-pass`} name="password" type={showPassword ? 'text' : 'password'}
          autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 12 : undefined}
          maxLength={registering ? 128 : 200} placeholder="••••••••" value={password} disabled={busy}
          onChange={(event) => setPassword(event.target.value)} required />
        <button type="button" className="qishi-eye" disabled={busy} aria-pressed={showPassword}
          aria-label={showPassword ? '隐藏访问口令' : '显示访问口令'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'HIDE' : 'SHOW'}</button>
      </div>
    </div>
    {registering && <>
      <div className="qishi-row">
        {label('nickname', '显示名称', 'DISPLAY')}
        <input className="qishi-input" id={`${fieldId}-nickname`} autoComplete="nickname" maxLength={30}
          value={nickname} disabled={busy} onChange={(event) => setNickname(event.target.value)} required />
      </div>
      <div className="qishi-row">
        {label('confirm', '再输一次', 'REPEAT')}
        <input className="qishi-input" id={`${fieldId}-confirm`} type="password" autoComplete="new-password"
          value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} required />
      </div>
    </>}
    <p key={errorVersion} className={`qishi-msg ${error ? 'is-err' : ''}`} role={error ? 'alert' : 'status'}>
      {error || (busy ? '核验中…' : registering ? '账号需为 3–32 位，口令至少 12 位。' : '')}
    </p>
    <div className="qishi-footrow">
      <label className="qishi-remember"><input type="checkbox" checked={remember} disabled={busy}
        onChange={(event) => setRemember(event.target.checked)} />记住这次核验</label>
      {openRegistration && <button className="qishi-link" type="button" disabled={busy} onClick={() => {
        setRegistering(!registering);
        setConfirmation('');
        setError('');
      }}>{registering ? '返回登录' : '登记新身份'}</button>}
    </div>
    {demoAccount && !registering && <div className="qishi-demo">
      <button className="qishi-demo-fill" type="button" disabled={busy} onClick={() => {
        if (!useDemoPicker) setAccount(demoAccount.id);
        setPassword(DEMO_PASSWORD);
      }}>
        <span>{useDemoPicker ? '演示口令' : '演示管理员'}</span>
        <code>{useDemoPicker ? DEMO_PASSWORD : demoAccount.id}</code><b>一键填入</b>
      </button>
    </div>}
    <button className={showIntro ? 'login-hidden-submit' : 'qishi-submit'} type="submit" disabled={busy}>
      <span>{registering ? '登记并进入' : '进入工作区'}</span><span className="qishi-submit-en">{registering ? 'REGISTER' : 'SIGN IN'}</span>
    </button>
  </form>;

  return <>
    <div ref={holder} />
    {showIntro && gate && createPortal(verified ? <div aria-live="polite">
      <div className="dsu-card-row"><span>身份名称</span><b className="dsu-zhname">{verified.user.name}</b></div>
      <div className="dsu-card-row"><span>身份编号</span><b>{verified.user.id}</b></div>
      <div className="dsu-card-row"><span>权限等级</span><b>{verified.user.role === 'admin' ? '3 · 管理员' : '1 · 成员'}</b></div>
      <div className="dsu-card-row"><span>核验时间</span><b><time dateTime={verified.at.toISOString()}>
        {verified.at.toLocaleTimeString('zh-CN', { hour12: false })}
      </time></b></div>
      <div className="qishi-ok"><i aria-hidden="true">✓</i>核验通过 · ACCESS GRANTED</div>
    </div> : fields, gate.card)}
    {!showIntro && <main className="qa-root qa-root--login">
      <div className="qa-login">
        <div className="qa-login-brand"><img className="qa-mark" src={`${base}/assets/cheese/cheese-black.png`} alt="" />
          <span className="qa-brand-mark">CHEESE</span><span className="qa-brand-sub">ACCESS CONTROL</span>
        </div>
        <section className="qa-login-plate">
          <header className="qa-login-head"><div className="qa-eyebrow">IDENTITY VERIFICATION</div>
            <h1>{registering ? '登记新身份' : '身份核验'}</h1>
          </header>
          {fields}
        </section>
        <div className="qa-login-foot"><span>柒柿 AI</span><span>工作区</span></div>
      </div>
    </main>}
  </>;
}
