import { useState, FormEvent } from "react";
import { api, ClientAppointment } from "../lib/api";
import { Icon } from "../components/Icon";
import { T } from "../theme/terra";

const brl = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
const MON = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const DOW = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function fmtDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  const dow = DOW[new Date(iso + "T00:00:00").getDay()];
  return `${dow}, ${d} ${MON[m - 1]}`;
}

function applyPhoneMask(digits: string): string {
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  if (digits.length <= 11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7,11)}`;
}

interface Studio { id: number; name: string; slug: string }

export default function MyAppointments() {
  const [phone,       setPhone]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [clientName,  setClientName]  = useState<string | null>(null);
  const [appts,       setAppts]       = useState<ClientAppointment[]>([]);
  const [selected,    setSelected]    = useState<number | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { client_name, appointments } = await api.client.lookup(phone);
      setClientName(client_name);
      setAppts(appointments);
      if (appointments.length > 0) setSelected(appointments[0].studio_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Telefone não encontrado.");
    } finally {
      setLoading(false);
    }
  }

  const studios: Studio[] = appts.reduce<Studio[]>((acc, a) => {
    if (!acc.find(s => s.id === a.studio_id))
      acc.push({ id: a.studio_id, name: a.studio_name, slug: a.studio_slug });
    return acc;
  }, []);

  const today    = new Date().toISOString().slice(0, 10);
  const filtered = appts.filter(a => a.studio_id === selected);
  const upcoming = [...filtered.filter(a => a.date >= today)].reverse();
  const past     = filtered.filter(a => a.date < today);

  const fld = {
    width: "100%", boxSizing: "border-box" as const,
    padding: "13px 14px", border: `1.5px solid ${T.line}`,
    borderRadius: T.radiusSm, fontSize: 15, color: T.ink,
    background: T.surface, fontFamily: T.body, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: T.primary, color: T.primaryInk, padding: "48px 24px 28px", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <Icon name="calendar" size={28} color={T.primaryInk} sw={1.5} />
        </div>
        <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 28 }}>
          {clientName ? `Olá, ${clientName.split(" ")[0]}!` : "Meus agendamentos"}
        </div>
        <p style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
          {clientName ? "Aqui estão seus agendamentos." : "Digite seu telefone para ver seus agendamentos."}
        </p>
      </div>

      <div style={{ flex: 1, maxWidth: 520, width: "100%", margin: "0 auto", padding: "24px 16px", boxSizing: "border-box" }}>

        {/* Formulário de busca */}
        {!clientName && (
          <>
            {error && (
              <div style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: T.radiusSm, padding: "11px 14px", fontSize: 14, marginBottom: 16 }}>
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="tel"
                placeholder="Seu WhatsApp (ex: 71 99999-0001)"
                value={phone}
                onChange={e => setPhone(applyPhoneMask(e.target.value.replace(/\D/g, "")))}
                required
                style={fld}
              />
              <button
                type="submit"
                disabled={loading}
                style={{ background: T.primary, color: T.primaryInk, border: "none", borderRadius: T.radius, padding: "15px", fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: T.body }}
              >
                {loading ? "Buscando…" : "Ver meus agendamentos →"}
              </button>
            </form>
          </>
        )}

        {/* Resultados */}
        {clientName && (
          <>
            {/* Studio cards — só aparece se tiver mais de 1 */}
            {studios.length > 1 && (
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, marginBottom: 20 }}>
                {studios.map(s => (
                  <button key={s.id} onClick={() => setSelected(s.id)} style={{
                    flexShrink: 0, padding: "10px 16px", borderRadius: T.radius,
                    border: `2px solid ${selected === s.id ? T.primary : T.line}`,
                    background: selected === s.id ? T.primarySoft : T.surface,
                    color: selected === s.id ? T.primary : T.ink,
                    fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: T.body,
                  }}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* Studio label único */}
            {studios.length === 1 && (
              <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name="polish" size={20} color={T.primary} sw={1.5} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{studios[0].name}</div>
                  <div style={{ fontSize: 12, color: T.inkSoft }}>/{studios[0].slug}</div>
                </div>
              </div>
            )}

            {upcoming.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Próximos agendamentos</div>
                {upcoming.map(a => <ApptCard key={a.id} appt={a} />)}
              </>
            )}

            {past.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: 1, margin: "22px 0 10px" }}>Agendamentos passados</div>
                {past.map(a => <ApptCard key={a.id} appt={a} muted />)}
              </>
            )}

            <button onClick={() => { setClientName(null); setAppts([]); setPhone(""); }} style={{ marginTop: 24, width: "100%", background: "transparent", border: "none", color: T.inkSoft, fontSize: 13.5, cursor: "pointer", fontFamily: T.body }}>
              Buscar outro número
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ApptCard({ appt: a, muted }: { appt: ClientAppointment; muted?: boolean }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius, padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14, opacity: muted ? 0.6 : 1 }}>
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
