import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { T } from "../theme/terra";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { token } = await api.auth.login(email, password);
      localStorage.setItem("token", token);
      const { studio_slug } = JSON.parse(atob(token.split('.')[1]))
      navigate(`/${studio_slug}/admin`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Credenciais incorretas");
    } finally {
      setLoading(false);
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

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        fontFamily: T.body,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Decorative top band */}
      <div
        style={{
          position: "relative",
          paddingTop: 64,
          paddingBottom: 30,
          textAlign: "center",
          background: T.primary,
          color: T.primaryInk,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 220,
            height: 220,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.14)",
            top: -70,
            right: -60,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 150,
            height: 150,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            bottom: -50,
            left: -40,
          }}
        />
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 999,
            background: "rgba(255,255,255,0.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <Icon name="polish" size={30} color={T.primaryInk} sw={1.5} />
        </div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: 4,
            textTransform: "uppercase",
            opacity: 0.8,
            fontWeight: 600,
          }}
        >
          Studio
        </div>
        <div
          style={{
            fontFamily: T.heading,
            fontWeight: T.headingWeight,
            fontSize: 34,
            lineHeight: 1.05,
            marginTop: 4,
          }}
        >
          Agenda
        </div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 3,
            textTransform: "uppercase",
            opacity: 0.85,
            marginTop: 6,
          }}
        >
          Unhas
        </div>
      </div>

      {/* Form */}
      <div
        style={{
          flex: 1,
          padding: "30px 24px",
          maxWidth: 440,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontFamily: T.heading,
            fontWeight: T.headingWeight,
            fontSize: 25,
            color: T.ink,
            textAlign: "center",
          }}
        >
          Painel de agendamentos
        </div>
        <p
          style={{
            fontSize: 13,
            color: T.inkSoft,
            textAlign: "center",
            marginTop: 6,
            marginBottom: 26,
          }}
        >
          Acesso restrito — entre para ver sua agenda.
        </p>

        {error && (
          <div
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fca5a5",
              borderRadius: T.radiusSm,
              padding: "11px 14px",
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: "block",
              fontSize: 11.5,
              fontWeight: 700,
              color: T.inkSoft,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 6,
            }}
          >
            E-mail
          </label>
          <input
            style={fld}
            type="email"
            autoComplete="email"
            placeholder="michele@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div style={{ height: 16 }} />

          <label
            style={{
              display: "block",
              fontSize: 11.5,
              fontWeight: 700,
              color: T.inkSoft,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 6,
            }}
          >
            Senha
          </label>
          <div style={{ position: "relative" }}>
            <input
              style={{ ...fld, paddingRight: 56 }}
              type={showPass ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              style={{
                position: "absolute",
                right: 6,
                top: 6,
                bottom: 6,
                width: 44,
                border: "none",
                background: "transparent",
                color: T.inkSoft,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: T.body,
              }}
            >
              {showPass ? "ocultar" : "ver"}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 26,
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
            {loading ? "Entrando…" : "Entrar"}
            {!loading && (
              <Icon name="arrowRight" size={19} color={T.primaryInk} />
            )}
          </button>
        </form>

        <button
          onClick={() => navigate("/setup")}
          style={{
            marginTop: 18,
            width: "100%",
            background: "transparent",
            border: "none",
            color: T.inkSoft,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: T.body,
          }}
        >
          Criar novo estúdio →
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            marginTop: 20,
            color: T.inkSoft,
          }}
        >
          <Icon name="shield" size={15} color={T.accent} />
          <span style={{ fontSize: 11.5 }}>
            Conexão segura · acesso restrito
          </span>
        </div>
      </div>
    </div>
  );
}
