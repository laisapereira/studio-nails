import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, Service, StudioConfig } from "../lib/api";
import { Icon } from "../components/Icon";
import { T, serviceTint, serviceIcon } from "../theme/terra";

type Step = "home" | "service" | "date" | "time" | "info" | "confirm" | "success";

type BookingState = {
  services: Service[];
  date: string;
  time: string;
  name: string;
  phone: string;
};

const STEPS: Step[] = ["service", "date", "time", "info", "confirm"];

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MON = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
const MON_FULL = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const endOf = (start: string, dur: number) =>
  hhmm(
    start
      .split(":")
      .map(Number)
      .reduce((h, m, i) => (i === 0 ? h + m * 60 : h + m), 0) + dur,
  );
const brl = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
const durFmt = (m: number) => {
  const h = Math.floor(m / 60),
    r = m % 60;
  return h === 0
    ? `${r}min`
    : r === 0
      ? `${h}h`
      : `${h}h${String(r).padStart(2, "0")}`;
};

function toRawPhone(formatted: string): string {
  const digits = formatted.replace(/\D/g, "");
  return digits.length === 11 ? `55${digits}` : digits;
}

function applyPhoneMask(digits: string): string {
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

// isodow: Mon=1 ... Sat=6, Sun=7 (same as PostgreSQL ISODOW)
function jsToIsodow(jsDow: number): number {
  return jsDow === 0 ? 7 : jsDow;
}

function bDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  const dow = DOW[new Date(iso + "T00:00:00").getDay()];
  return { day: d, mon: MON[m - 1], monFull: MON_FULL[m - 1], dow };
}

export default function Booking() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("home");
  const [services, setServices] = useState<Service[]>([]);
  const [config, setConfig] = useState<StudioConfig>({
    studio_name: '', studio_slug: '', work_days: [1,2,3,4,5], work_start: '09:00', work_end: '18:00',
  })
  const [booking, setBooking] = useState<BookingState>({
    services: [],
    date: "",
    time: "",
    name: "",
    phone: "",
  });
  const [slots, setSlots] = useState<string[]>([]);
  const [datesWithSlots, setDatesWithSlots] = useState<string[] | null>(null);
  const [datesChecking, setDatesChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduleModal, setRescheduleModal] = useState<{ id: string; date: string; start_time: string; service_name: string; all_service_names: string } | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);

  const set = (patch: Partial<BookingState>) =>
    setBooking((prev) => ({ ...prev, ...patch }));

  const primaryService = booking.services[0] ?? null;
  const totalDuration  = booking.services.reduce((s, sv) => s + sv.duration, 0);
  const totalPrice     = booking.services.reduce((s, sv) => s + sv.price, 0);

  function toggleService(svc: Service) {
    setBooking(prev => {
      const exists = prev.services.find(s => s.id === svc.id);
      return {
        ...prev,
        services: exists
          ? prev.services.filter(s => s.id !== svc.id)
          : [...prev.services, svc],
        // limpa horário ao mudar serviços
        time: "",
      };
    });
  }

  useEffect(() => {
    if (!slug) return;
    Promise.all([
      api.services.list(slug).then(setServices),
      api.config.get(slug).then(setConfig),
    ]).catch(() => {});
  }, [slug]);

  useEffect(() => {
    if (step !== "date" || booking.services.length === 0 || !slug) return;
    setDatesChecking(true);
    setDatesWithSlots(null);
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end90 = new Date(today);
    end90.setDate(today.getDate() + 90);
    const end = end90.toISOString().slice(0, 10);
    const ids = booking.services.map(s => s.id);
    api.appointments
      .availableDates(start, end, ids.length === 1 ? ids[0] : ids, slug)
      .then(setDatesWithSlots)
      .catch(() => setDatesWithSlots(null))
      .finally(() => setDatesChecking(false));
  }, [step, booking.services, slug]);

  useEffect(() => {
    if (!booking.date || booking.services.length === 0 || !slug) return;
    setSlotsLoading(true);
    setSlots([]);
    setError(null);
    const ids = booking.services.map(s => s.id);
    const dateSnap = booking.date;
    api.appointments
      .slots(dateSnap, ids.length === 1 ? ids[0] : ids, slug)
      .then(fetched => {
        setSlots(fetched);
        if (fetched.length === 0) {
          setDatesWithSlots(prev => prev ? prev.filter(d => d !== dateSnap) : prev);
        }
      })
      .catch(() => setError("Erro ao buscar horários. Tente novamente."))
      .finally(() => setSlotsLoading(false));
  }, [booking.date, booking.services, slug]);

  async function handleConfirm() {
    if (booking.services.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const ids = booking.services.map(s => s.id);
      await api.appointments.create({
        client_name: booking.name.trim(),
        phone: toRawPhone(booking.phone),
        ...(ids.length === 1 ? { service_id: ids[0] } : { service_ids: ids }),
        date: booking.date,
        start_time: `${booking.time}:00`,
        created_via: "website",
        studio: slug,
        ...(rescheduleId ? { reschedule_id: rescheduleId } : {}),
      });
      setRescheduleId(null);
      setStep("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (
        msg.toLowerCase().includes("ocupado") ||
        msg.toLowerCase().includes("conflict")
      ) {
        setError("Este horário acabou de ser ocupado. Escolha outro.");
        setStep("time");
      } else {
        setError("Não foi possível confirmar. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  }

  const availableDates = useMemo(() => {
    const dates: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 90 && dates.length < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      if (config.work_days.includes(jsToIsodow(d.getDay()))) {
        dates.push(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        );
      }
    }
    return dates;
  }, [config.work_days]);
  const idx = STEPS.indexOf(step);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  async function checkExistingAndProceed() {
    const rawPhone = toRawPhone(booking.phone);
    setCheckingExisting(true);
    try {
      const appts = await api.appointments.checkExisting(rawPhone, slug);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // compara com a data escolhida, não com hoje
      const newDate = new Date(booking.date + 'T00:00:00');
      const upcoming = appts.filter(a => {
        const d = new Date(a.date + 'T00:00:00');
        const diffDays = Math.abs((d.getTime() - newDate.getTime()) / 86400000);
        return d >= today && diffDays <= 7;
      });
      if (upcoming.length > 0) {
        setRescheduleModal(upcoming[0]);
      } else {
        go('confirm');
      }
    } catch (err) {
      console.error('[checkExisting] falhou, seguindo sem popup:', err);
      go('confirm');
    } finally {
      setCheckingExisting(false);
    }
  }

  const fld = {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "13px 14px",
    border: `1.5px solid ${T.line}`,
    borderRadius: T.radiusSm,
    fontSize: 15,
    color: T.ink,
    background: T.surface,
    fontFamily: T.body,
    outline: "none",
  };
  const lbl = {
    display: "block",
    fontSize: 11.5,
    fontWeight: 700,
    color: T.inkSoft,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: T.bg,
        color: T.ink,
        fontFamily: T.body,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: T.surface,
          borderBottom: `1px solid ${T.lineSoft}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "16px 20px 12px",
          }}
        >
          {step !== "home" && step !== "service" && step !== "success" && (
            <button
              onClick={() => go(STEPS[Math.max(0, idx - 1)])}
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                border: `1px solid ${T.lineSoft}`,
                background: T.surface,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Icon name="chevronLeft" size={18} color={T.ink} />
            </button>
          )}
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: T.heading,
                fontWeight: T.headingWeight,
                fontSize: 20,
                lineHeight: 1,
                color: T.ink,
              }}
            >
              {config.studio_name || '…'}
            </div>
            <div
              style={{
                fontSize: 9.5,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: T.accent,
                marginTop: 3,
                fontWeight: 600,
              }}
            >
              Agendamento online
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: T.inkSoft,
              fontWeight: 600,
            }}
          >
            <Icon name="shield" size={15} color={T.accent} /> cuidando de você
            ❤️
          </div>
        </div>

        {step !== "home" && step !== "success" && (
          <div style={{ display: "flex", gap: 5, padding: "0 20px 14px" }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 3,
                  background: i <= idx ? T.primary : T.lineSoft,
                  transition: "background .3s",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          padding: "20px 20px 110px",
          maxWidth: 520,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        {error && (
          <div
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fca5a5",
              borderRadius: T.radiusSm,
              padding: "11px 14px",
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {/* Chips */}
        {booking.services.length > 0 && step !== "home" && step !== "service" && step !== "success" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 20 }}>
            {[
              booking.services.map(s => s.name).join(" + "),
              booking.date ? `${bDate(booking.date).dow} ${bDate(booking.date).day}` : null,
              booking.time || null,
            ]
              .filter(Boolean)
              .map((x, i) => (
                <span key={i} style={{ fontSize: 12, fontWeight: 600, color: T.primary, background: T.primarySoft, borderRadius: 999, padding: "5px 12px" }}>
                  {x}
                </span>
              ))}
          </div>
        )}

        {/* STEP: home */}
        {step === "home" && (
          <div style={{ paddingTop: 16 }}>
            <div
              style={{
                fontFamily: T.heading,
                fontWeight: T.headingWeight,
                fontSize: 26,
                color: T.ink,
                marginBottom: 6,
              }}
            >
              Olá! 💅
            </div>
            <p style={{ fontSize: 14, color: T.inkSoft, marginBottom: 28, lineHeight: 1.5 }}>
              O que você deseja fazer?
            </p>

            <button
              onClick={() => go("service")}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 16,
                padding: "18px 20px", marginBottom: 12,
                background: T.primary, color: T.primaryInk,
                border: "none", borderRadius: T.radius,
                cursor: "pointer", fontFamily: T.body, textAlign: "left",
                boxShadow: "0 8px 20px -8px rgba(0,0,0,0.35)",
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="calendar" size={22} color={T.primaryInk} sw={1.5} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Agendar novo horário</div>
                <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 2 }}>Escolha serviço, data e horário</div>
              </div>
            </button>

            <button
              onClick={() => navigate(`/meus-agendamentos`)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 16,
                padding: "18px 20px",
                background: T.surface, color: T.ink,
                border: `1.5px solid ${T.line}`, borderRadius: T.radius,
                cursor: "pointer", fontFamily: T.body,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: T.primarySoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="clock" size={22} color={T.primary} sw={1.5} />
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>Meus agendamentos</div>
                <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 2 }}>Veja seus próximos horários</div>
              </div>
            </button>
          </div>
        )}

        {/* STEP: service */}
        {step === "service" && (
          <Section kicker="Passo 1 de 5" title="Escolha o serviço">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginTop: 16,
              }}
            >
              {services.length === 0 && (
                <p style={{ fontSize: 14, color: T.inkSoft }}>
                  Carregando serviços…
                </p>
              )}
              {services.map((svc) => {
                const c        = serviceTint(svc.id);
                const selected = booking.services.some(s => s.id === svc.id);
                return (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc)}
                    style={{
                      display: "flex", alignItems: "center", gap: 14,
                      padding: "14px 15px", cursor: "pointer",
                      background: selected ? T.primarySoft : T.surface,
                      border: `1.5px solid ${selected ? T.primary : T.line}`,
                      borderRadius: T.radius, textAlign: "left", fontFamily: T.body,
                    }}
                  >
                    <div style={{ width: 46, height: 46, borderRadius: 13, background: c.tint, color: c.ink, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name={serviceIcon(svc.id)} size={24} sw={1.5} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 700, color: T.ink }}>{svc.name}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 2 }}>{durFmt(svc.duration)}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 18, color: T.ink }}>
                        {brl(svc.price).replace("R$ ", "R$")}
                      </div>
                      <div style={{ width: 22, height: 22, borderRadius: 999, border: `2px solid ${selected ? T.primary : T.line}`, background: selected ? T.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {selected && <Icon name="check" size={13} color={T.primaryInk} sw={2.5} />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {booking.services.length > 0 && (
              <div style={{ marginTop: 16, background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 10 }}>
                  <span style={{ color: T.inkSoft, fontSize: 13 }}>{durFmt(totalDuration)} no total</span>
                  <span>{brl(totalPrice)}</span>
                </div>
                <button onClick={() => go("date")} style={{ width: "100%", background: T.primary, color: T.primaryInk, border: "none", borderRadius: T.radius, padding: "13px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: T.body }}>
                  Continuar →
                </button>
              </div>
            )}
          </Section>
        )}

        {/* STEP: date */}
        {step === "date" && (
          <Section
            kicker="Passo 2 de 5"
            title="Qual dia?"
            sub="Segunda a sexta · próximos 30 dias úteis"
          >
            {datesChecking ? (
              <p style={{ fontSize: 14, color: T.inkSoft, marginTop: 20 }}>
                Verificando disponibilidade…
              </p>
            ) : (() => {
              const displayDates = datesWithSlots !== null
                ? availableDates.filter(d => datesWithSlots.includes(d))
                : availableDates;
              return displayDates.length === 0 ? (
                <p style={{ fontSize: 14, color: T.inkSoft, marginTop: 20 }}>
                  Nenhum horário disponível nos próximos 30 dias. Entre em contato pelo WhatsApp.
                </p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 9,
                    marginTop: 16,
                  }}
                >
                  {displayDates.map((iso) => {
                    const d = bDate(iso);
                    const on = booking.date === iso;
                    return (
                      <button
                        key={iso}
                        onClick={() => {
                          set({ date: iso, time: "" });
                          go("time");
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 2,
                          padding: "12px 4px",
                          cursor: "pointer",
                          fontFamily: T.body,
                          background: on ? T.primary : T.surface,
                          color: on ? T.primaryInk : T.ink,
                          border: `1px solid ${on ? T.primary : T.line}`,
                          borderRadius: T.radiusSm,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            opacity: 0.75,
                          }}
                        >
                          {d.dow}
                        </span>
                        <span
                          style={{
                            fontFamily: T.heading,
                            fontWeight: T.headingWeight,
                            fontSize: 22,
                            lineHeight: 1,
                          }}
                        >
                          {d.day}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.7 }}>{d.mon}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </Section>
        )}

        {/* STEP: time */}
        {step === "time" && (
          <Section
            kicker="Passo 3 de 5"
            title="Escolha o horário"
            sub={
              booking.services.length > 0
                ? `${durFmt(totalDuration)} · termina no horário mostrado`
                : undefined
            }
          >
            {slotsLoading ? (
              <p style={{ fontSize: 14, color: T.inkSoft, marginTop: 20 }}>
                Buscando horários…
              </p>
            ) : slots.length === 0 && !slotsLoading ? (
              <div style={{ marginTop: 20, textAlign: "center" }}>
                <p style={{ fontSize: 14, color: T.inkSoft, marginBottom: 20 }}>
                  Sem horários livres nesse dia. Tente outra data.
                </p>
                <button
                  onClick={() => go("date")}
                  style={{
                    background: T.primary,
                    color: T.primaryInk,
                    border: "none",
                    borderRadius: T.radius,
                    padding: "14px 28px",
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: "pointer",
                    fontFamily: T.body,
                  }}
                >
                  Escolher outra data
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 9,
                  marginTop: 16,
                }}
              >
                {slots.map((s) => {
                  const on = booking.time === s;
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        set({ time: s });
                        go("info");
                      }}
                      style={{
                        padding: "13px 4px",
                        cursor: "pointer",
                        fontFamily: T.body,
                        background: on ? T.primary : T.surface,
                        color: on ? T.primaryInk : T.ink,
                        border: `1px solid ${on ? T.primary : T.line}`,
                        borderRadius: T.radiusSm,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 1,
                      }}
                    >
                      <span style={{ fontSize: 16, fontWeight: 700 }}>{s}</span>
                      {primaryService && (
                        <span style={{ fontSize: 10, opacity: 0.65 }}>
                          → {endOf(s, totalDuration)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        )}

        {/* STEP: info */}
        {step === "info" && (
          <Section kicker="Passo 4 de 5" title="Seus dados">
            <div style={{ marginTop: 18 }}>
              <label style={lbl}>Nome completo</label>
              <input
                value={booking.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Ex: Ana Lima"
                style={fld}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>WhatsApp</label>
              <input
                value={booking.phone}
                inputMode="tel"
                placeholder="(71) 99999-0000"
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
                  set({ phone: digits ? applyPhoneMask(digits) : "" });
                }}
                style={fld}
              />
            </div>
          </Section>
        )}

        {/* STEP: confirm */}
        {step === "confirm" && booking.services.length > 0 && (
          <Section kicker="Passo 5 de 5" title="Confirmar">
            <div
              style={{
                background: T.surface,
                border: `1px solid ${T.line}`,
                borderRadius: T.radius,
                padding: "4px 16px",
                marginTop: 16,
              }}
            >
              {[
                ["Serviço", booking.services.map(s => s.name).join(" + ")],
                [
                  "Dia",
                  booking.date
                    ? `${bDate(booking.date).dow}, ${bDate(booking.date).day} de ${bDate(booking.date).monFull}`
                    : "",
                ],
                [
                  "Horário",
                  `${booking.time} → ${endOf(booking.time, totalDuration)}`,
                ],
                ["Duração", durFmt(totalDuration)],
                ["Nome", booking.name],
                ["WhatsApp", booking.phone],
              ].map(([k, v], i) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "12px 0",
                    borderBottom: i < 5 ? `1px solid ${T.lineSoft}` : "none",
                  }}
                >
                  <span
                    style={{ fontSize: 13.5, color: T.inkSoft, flexShrink: 0 }}
                  >
                    {k}
                  </span>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: T.ink,
                      textAlign: "right",
                    }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 16,
                padding: "0 4px",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: T.inkSoft,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  fontWeight: 700,
                }}
              >
                Total
              </span>
              <span
                style={{
                  fontFamily: T.heading,
                  fontWeight: T.headingWeight,
                  fontSize: 28,
                  color: T.primary,
                }}
              >
                {brl(totalPrice)}
              </span>
            </div>
          </Section>
        )}

        {/* STEP: success */}
        {step === "success" && primaryService && (
          <div style={{ textAlign: "center", paddingTop: 24 }}>
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: 999,
                background: T.primarySoft,
                color: T.primary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <Icon name="check" size={44} sw={2} />
            </div>
            <div
              style={{
                fontFamily: T.heading,
                fontWeight: T.headingWeight,
                fontSize: 30,
                color: T.ink,
                lineHeight: 1.1,
              }}
            >
              Agendado, {(booking.name || "cliente").split(" ")[0]}!
            </div>
            <p
              style={{
                fontSize: 14,
                color: T.inkSoft,
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              Te vejo{" "}
              {booking.date &&
                `${bDate(booking.date).dow}, ${bDate(booking.date).day} de ${bDate(booking.date).monFull}`}
              <br />
              às {booking.time}.
            </p>
            <div
              style={{
                background: T.surface,
                border: `1px solid ${T.line}`,
                borderRadius: T.radius,
                padding: "16px",
                marginTop: 22,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 13,
              }}
            >
              {(() => {
                const c = serviceTint(primaryService!.id);
                return (
                  <div style={{ width: 46, height: 46, borderRadius: 13, background: c.tint, color: c.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={serviceIcon(primaryService!.id)} size={24} sw={1.5} />
                  </div>
                );
              })()}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {booking.services.map(s => s.name).join(" + ")}
                </div>
                <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 1 }}>
                  {booking.time} → {endOf(booking.time, totalDuration)} · {brl(totalPrice)}
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate(`/meus-agendamentos`)}
              style={{ width: "100%", marginTop: 22, background: T.primarySoft, color: T.primary, border: "none", borderRadius: T.radius, padding: "14px 16px", fontSize: 14, fontWeight: 700, textAlign: "center", cursor: "pointer", fontFamily: T.body }}
            >
              Ver meus agendamentos →
            </button>

            <button
              onClick={() => {
                setBooking({ services: [], date: "", time: "", name: "", phone: "" });
                go("home");
              }}
              style={{
                marginTop: 16,
                background: "transparent",
                border: "none",
                color: T.primary,
                fontWeight: 700,
                fontSize: 14.5,
                cursor: "pointer",
                fontFamily: T.body,
              }}
            >
              Fazer outro agendamento
            </button>
          </div>
        )}
      </div>

      {/* Modal de remarcação */}
      {rescheduleModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 999, padding: '0 0 0 0',
        }}>
          <div style={{
            background: T.surface, borderRadius: `${T.radius} ${T.radius} 0 0`,
            padding: '28px 20px 40px', maxWidth: 520, width: '100%',
          }}>
            <div style={{ fontFamily: T.heading, fontWeight: T.headingWeight, fontSize: 22, color: T.ink, marginBottom: 16 }}>
              Você já tem um agendamento!
            </div>
            <div style={{ background: T.bg, borderRadius: T.radiusSm, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>
                📅 {(() => { const d = bDate(rescheduleModal.date); return `${d.dow}, ${d.day} de ${d.monFull}`; })()}
              </span>
              <span style={{ fontSize: 13.5, color: T.inkSoft }}>
                🕐 {rescheduleModal.start_time.slice(0, 5)}
              </span>
              <span style={{ fontSize: 13.5, color: T.inkSoft }}>
                ✨ {rescheduleModal.all_service_names}
              </span>
            </div>
            <p style={{ fontSize: 14, color: T.inkSoft, margin: '14px 0 20px', lineHeight: 1.5 }}>
              Deseja remarcar para o novo horário que você escolheu?
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => {
                  setRescheduleId(rescheduleModal.id);
                  setRescheduleModal(null);
                  go('confirm');
                }}
                style={{ flex: 1, background: T.primary, color: T.primaryInk, border: 'none', borderRadius: T.radius, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: T.body }}
              >
                Sim, remarcar
              </button>
              <button
                onClick={() => {
                  setRescheduleId(null);
                  setRescheduleModal(null);
                  go('confirm');
                }}
                style={{ flex: 1, background: T.surface, color: T.ink, border: `1.5px solid ${T.line}`, borderRadius: T.radius, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: T.body }}
              >
                Não, criar novo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky CTA */}
      {(step === "info" || step === "confirm") && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "14px 20px 30px",
            background: `linear-gradient(to top, ${T.bg} 60%, transparent)`,
          }}
        >
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            {step === "info" &&
              (() => {
                const ok =
                  booking.name.trim().length >= 2 &&
                  booking.phone.replace(/\D/g, "").length >= 10;
                return (
                  <button
                    onClick={() => ok && !checkingExisting && checkExistingAndProceed()}
                    disabled={!ok || checkingExisting}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 9,
                      background: T.primary,
                      color: T.primaryInk,
                      border: "none",
                      borderRadius: T.radius,
                      padding: "16px",
                      fontSize: 16,
                      fontWeight: 700,
                      cursor: ok ? "pointer" : "default",
                      opacity: ok ? 1 : 0.45,
                      fontFamily: T.body,
                      boxShadow: "0 10px 24px -10px rgba(0,0,0,0.4)",
                    }}
                  >
                    {checkingExisting ? "Verificando…" : "Continuar"}{" "}
                    {!checkingExisting && <Icon name="arrowRight" size={19} color={T.primaryInk} />}
                  </button>
                );
              })()}
            {step === "confirm" && (
              <button
                onClick={handleConfirm}
                disabled={loading}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 9,
                  background: T.primary,
                  color: T.primaryInk,
                  border: "none",
                  borderRadius: T.radius,
                  padding: "16px",
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: loading ? "default" : "pointer",
                  opacity: loading ? 0.7 : 1,
                  fontFamily: T.body,
                  boxShadow: "0 10px 24px -10px rgba(0,0,0,0.4)",
                }}
              >
                {loading ? "Agendando…" : "Confirmar agendamento"}
                {!loading && (
                  <Icon name="check" size={20} color={T.primaryInk} sw={2} />
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  kicker,
  title,
  sub,
  children,
}: {
  kicker: string;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: T.accent,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          fontFamily: T.heading,
          fontWeight: T.headingWeight,
          fontSize: 28,
          color: T.ink,
          marginTop: 5,
          lineHeight: 1.05,
        }}
      >
        {title}
      </div>
      {sub && (
        <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 6 }}>{sub}</p>
      )}
      {children}
    </div>
  );
}
