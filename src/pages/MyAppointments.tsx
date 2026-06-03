import { useState, useEffect, FormEvent } from "react";
import { api, ClientAppointment } from "../lib/api";
import { Icon } from "../components/Icon";
import { T } from "../theme/terra";

const brl  = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
const MON  = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const DOW  = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function fmtDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  const dow = DOW[new Date(iso + "T00:00:00").getDay()];
  return `${dow}, ${d} ${MON[m - 1]}`;
}

interface Studio {
  id: number;
  name: string;
  slug: string;
}

export default function MyAppointments() {
  const [loggedIn,   setLoggedIn]   = useState(!!localStorage.getItem("client_token"));
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [appts,    setAppts]    = useState<ClientAppointment[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const studios: Studio[] = appts
    .reduce<Studio[]>((acc, a) => {
      if (!acc.find(s => s.id === a.studio_id))
        acc.push({ id: a.studio_id, name: a.studio_name, slug: a.studio_slug });
      return acc;
    }, []);

  useEffect(() => {
    if (!loggedIn) return;
    setLoading(true);
    api.client.appointments()
      .then(data => { setAppts(data); if (data.length > 0) setSelected(data[0].studio_id); })
      .catch(() => { localStorage.removeItem("client_token"); setLoggedIn(false); })
      .finally(() => setLoading(false));
  }, [loggedIn]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const { token } = await api.client.login(email, password);
      localStorage.setItem("client_token", token);
      setLoggedIn(true);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Credenciais incorretas.");
    } finally {
      setLoginLoading(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const filtered  = appts.filter(a => a.studio_id === selected);
  const upcoming  = filtered.filter(a => a.date >= today).reverse();
  const past      = filtered.filter(a => a.date <  today);

  const fld = {
    width: "100%", boxSizing: "border-box" as const,
    padding: "13px 14px", border: `1.5px solid ${T.line}`,
    borderRadius: T.radiusSm, fontSize: 15, color: T.ink,
    background: T.surface, fontFamily: T.body, outline: "none",
  };

  if (!loggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body, display: "flex", flexDirection: "column" }}>
        <div style={{ background: T.primary, color: T.primaryInk, padding: "48px 24px 28px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 999, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Icon name="calendar" size={28} color={T.primaryInk} sw={1.5} />
          </div>
          <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 28 }}>Meus agendamentos</div>
          <p style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>Entre para ver todos os seus agendamentos.</p>
        </div>
        <div style={{ flex: 1, padding: "28px 24px", maxWidth: 440, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          {loginError && (
            <div style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: T.radiusSm, padding: "11px 14px", fontSize: 14, marginBottom: 18 }}>
              {loginError}
            </div>
          )}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="email" placeholder="Seu e-mail" value={email} onChange={e => setEmail(e.target.value)} required style={fld} />
            <input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} required style={fld} />
            <button
              type="submit"
              disabled={loginLoading}
              style={{ background: T.primary, color: T.primaryInk, border: "none", borderRadius: T.radius, padding: "15px", fontSize: 15, fontWeight: 700, cursor: loginLoading ? "default" : "pointer", opacity: loginLoading ? 0.7 : 1, fontFamily: T.body }}
            >
              {loginLoading ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body }}>
      {/* Header */}
      <div style={{ background: T.primary, color: T.primaryInk, padding: "40px 20px 22px", textAlign: "center" }}>
        <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 26 }}>Meus agendamentos</div>
        <button onClick={() => { localStorage.removeItem("client_token"); setLoggedIn(false); }} style={{ marginTop: 8, background: "transparent", border: "none", color: "rgba(255,255,255,0.7)", fontSize: 12, cursor: "pointer", fontFamily: T.body }}>
          Sair
        </button>
      </div>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "20px 16px" }}>
        {loading && <p style={{ textAlign: "center", color: T.inkSoft }}>Carregando…</p>}

        {!loading && studios.length === 0 && (
          <p style={{ textAlign: "center", color: T.inkSoft, marginTop: 40 }}>Nenhum agendamento encontrado.</p>
        )}

        {/* Studio cards */}
        {studios.length > 1 && (
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, marginBottom: 20 }}>
            {studios.map(s => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                style={{
                  flexShrink: 0, padding: "10px 16px", borderRadius: T.radius,
                  border: `2px solid ${selected === s.id ? T.primary : T.line}`,
                  background: selected === s.id ? T.primarySoft : T.surface,
                  color: selected === s.id ? T.primary : T.ink,
                  fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: T.body,
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* Single studio label */}
        {studios.length === 1 && (
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="polish" size={20} color={T.primary} sw={1.5} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{studios[0].name}</div>
              <div style={{ fontSize: 12, color: T.inkSoft }}>/{studios[0].slug}</div>
            </div>
          </div>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Próximos agendamentos</div>
            {upcoming.map(a => <ApptCard key={a.id} appt={a} />)}
          </>
        )}

        {/* Past */}
        {past.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: 1, margin: "22px 0 10px" }}>Agendamentos passados</div>
            {past.map(a => <ApptCard key={a.id} appt={a} muted />)}
          </>
        )}
      </div>
    </div>
  );
}

function ApptCard({ appt: a, muted }: { appt: ClientAppointment; muted?: boolean }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius,
      padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14,
      opacity: muted ? 0.6 : 1,
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: a.service_color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
        {a.service_emoji}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{a.service_name}</div>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 2 }}>
          {fmtDate(a.date)} · {a.start_time} → {a.end_time}
        </div>
        <div style={{ fontSize: 12, color: T.inkSoft }}>{brl(a.service_price)}</div>
      </div>
      {a.status === "confirmed" && (
        <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", background: "#dcfce7", borderRadius: 6, padding: "3px 8px" }}>confirmado</div>
      )}
      {a.status === "completed" && (
        <div style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, background: T.line, borderRadius: 6, padding: "3px 8px" }}>concluído</div>
      )}
    </div>
  );
}
