import { useState } from 'react';
import { getApiToken } from '../lib/auth';

const CLI_ROOT_URL =
  typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost:9200';

export function CliAccess() {
  const [copied, setCopied] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const token = getApiToken();
  const envBlock = `METABOT_CORE_URL=${CLI_ROOT_URL}\nMETABOT_CORE_TOKEN=${token}`;
  const installCmd = `curl -fsSL ${CLI_ROOT_URL}/cli/install.sh | METABOT_CORE_TOKEN=${token} bash`;

  async function copy(value: string, setState: (value: boolean) => void) {
    try {
      await navigator.clipboard.writeText(value);
      setState(true);
      setTimeout(() => setState(false), 1800);
    } catch {
      setState(false);
    }
  }

  return (
    <div className="main">
      <aside className="sidebar">
        <div className="sidebar-section">
          <span>cli access</span>
        </div>
        <div style={{ padding: '0 18px', color: 'var(--bone-300)', fontSize: 11, lineHeight: 1.6 }}>
          reuse the current personal-edition token with the <code style={{ color: 'var(--amber)' }}>metabot</code> CLI.
        </div>
        <div style={{ padding: '12px 18px 0', color: 'var(--bone-300)', fontSize: 11, lineHeight: 1.6 }}>
          this page never creates, rotates, or uploads credentials.
        </div>
      </aside>
      <div className="content">
        <div className="page-head">
          <div>
            <div className="kicker">personal edition</div>
            <h1>cli access</h1>
          </div>
          <span className="crumbs">/ cli</span>
        </div>

        <div className="cli-access">
          <p className="cli-access-lead">Use the same local token that authenticated this browser with the CLI.</p>

          <div className="cli-access-result">
            <div className="env-block-head">
              <span className="kicker">.env</span>
              <button className="btn secondary" onClick={() => copy(envBlock, setCopied)}>
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            <pre className="env-block">{envBlock}</pre>

            <div className="env-block-head" style={{ marginTop: 18 }}>
              <span className="kicker">CLI-only install</span>
              <button className="btn secondary" onClick={() => copy(installCmd, setCopiedInstall)}>
                {copiedInstall ? 'copied' : 'copy'}
              </button>
            </div>
            <pre className="env-block">{installCmd}</pre>
            <div className="cli-access-meta" style={{ marginBottom: 12 }}>
              <span style={{ color: 'var(--bone-300)', fontSize: 11 }}>
                The token appears in shell history. Use a protected env file when possible; Node &gt;= 22.19 is required.
              </span>
            </div>

            <div className="cli-access-once">
              Sign out when using a shared browser. Rotate credentials with the local admin CLI, not through the browser
              console.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
