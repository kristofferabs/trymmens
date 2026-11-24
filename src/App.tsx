import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { Clip, PartyState, Rating, Tab } from "./lib/types";
import { parseYouTubeId, scoreToString } from "./lib/youtube";

const PARTY_SLUG = import.meta.env.VITE_PARTY_SLUG || "trymmens";
const SESSION_KEY = "clip-party-joined";
const RATING_FIELDS: Array<{ key: keyof Rating; label: string; icon: string }> = [
  { key: "funny", label: "Funny", icon: "😄" },
  { key: "creative", label: "Creative", icon: "✨" },
  { key: "christmas", label: "Christmas spirit", icon: "🎄" },
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "Something went wrong. Please try again.";
}

async function getAnonymousSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return;
  const signIn = await supabase.auth.signInAnonymously();
  if (signIn.error) throw signIn.error;
}

function StarRating({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="stars" role="group" aria-label={`${label} rating`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          aria-label={`${star} out of 5`}
          aria-pressed={value === star}
          className={star <= value ? "star active" : "star"}
          disabled={disabled}
          key={star}
          onClick={() => onChange(star)}
          type="button"
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ClipCard({
  clip,
  votingOpen,
  onRated,
}: {
  clip: Clip;
  votingOpen: boolean;
  onRated: (id: string, rating: Rating) => Promise<void>;
}) {
  const [rating, setRating] = useState<Rating>(
    clip.myRating ?? { funny: 0, creative: 0, christmas: 0 },
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setSaving(true);
    setMessage("");
    try {
      await onRated(clip.id, rating);
      setMessage("Rating saved!");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const complete = Object.values(rating).every((value) => value > 0);

  return (
    <article className="clip-card">
      <div className="video-wrap">
        <iframe
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          src={`https://www.youtube-nocookie.com/embed/${clip.youtubeId}`}
          title={clip.title}
        />
      </div>
      <div className="clip-content">
        <div className="clip-heading">
          <div>
            <span className="eyebrow">Clip {clip.position}</span>
            <h2>{clip.title}</h2>
          </div>
          <div className="score-badge" aria-label={`Score ${scoreToString(clip.score)} out of 5`}>
            <strong>{scoreToString(clip.score)}</strong>
            <span>{clip.voteCount} {clip.voteCount === 1 ? "vote" : "votes"}</span>
          </div>
        </div>
        <div className="rating-list">
          {RATING_FIELDS.map((field) => (
            <div className="rating-row" key={field.key}>
              <span>{field.icon} {field.label}</span>
              <StarRating
                disabled={!votingOpen || saving}
                label={field.label}
                onChange={(value) =>
                  setRating((current) => ({ ...current, [field.key]: value }))
                }
                value={rating[field.key]}
              />
            </div>
          ))}
        </div>
        <button
          className="primary-button"
          disabled={!votingOpen || !complete || saving}
          onClick={submit}
          type="button"
        >
          {saving ? "Saving…" : clip.myRating ? "Update my rating" : "Submit rating"}
        </button>
        {!votingOpen && <p className="status-note">Voting has closed.</p>}
        {message && <p className="status-note" role="status">{message}</p>}
      </div>
    </article>
  );
}

function Leaderboard({ clips }: { clips: Clip[] }) {
  const ranked = useMemo(
    () =>
      [...clips].sort(
        (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.voteCount - a.voteCount,
      ),
    [clips],
  );

  if (!ranked.length) return <p className="empty-state">No clips have been added yet.</p>;

  return (
    <div className="leaderboard-list">
      {ranked.map((clip, index) => (
        <div className={index < 3 ? `leader-card place-${index + 1}` : "leader-card"} key={clip.id}>
          <span className="rank">{index === 0 ? "👑" : index + 1}</span>
          <img
            alt=""
            loading="lazy"
            src={`https://i.ytimg.com/vi/${clip.youtubeId}/mqdefault.jpg`}
          />
          <div className="leader-title">
            <h2>{clip.title}</h2>
            <span>{clip.voteCount} {clip.voteCount === 1 ? "vote" : "votes"}</span>
          </div>
          <strong className="leader-score">{scoreToString(clip.score)}</strong>
        </div>
      ))}
    </div>
  );
}

function Admin({ onBack }: { onBack: () => void }) {
  const [secret, setSecret] = useState("");
  const [state, setState] = useState<PartyState | null>(null);
  const [title, setTitle] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const manage = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!secret) {
      setError("Enter the organizer password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await getAnonymousSession();
      const { data, error: rpcError } = await supabase.rpc("admin_manage_party", {
        p_slug: PARTY_SLUG,
        p_secret: secret,
        p_action: action,
        p_payload: payload,
      });
      if (rpcError) throw rpcError;
      setState(data as PartyState);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const addClip = async (event: FormEvent) => {
    event.preventDefault();
    const youtubeId = parseYouTubeId(youtubeUrl);
    if (!youtubeId) {
      setError("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }
    await manage("save_clip", { title: title.trim(), youtubeId });
    setTitle("");
    setYoutubeUrl("");
  };

  if (!state) {
    return (
      <main className="join-screen">
        <button className="text-button" onClick={onBack} type="button">← Back to party</button>
        <section className="join-card">
          <span className="hero-icon">🛠️</span>
          <span className="eyebrow">Organizer room</span>
          <h1>Manage the party</h1>
          <form onSubmit={(event) => { event.preventDefault(); void manage("get_state"); }}>
            <label htmlFor="admin-secret">Organizer password</label>
            <input
              autoComplete="current-password"
              id="admin-secret"
              onChange={(event) => setSecret(event.target.value)}
              required
              type="password"
              value={secret}
            />
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Opening…" : "Open organizer room"}
            </button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell admin-shell">
      <header className="topbar">
        <div><span className="eyebrow">Organizer room</span><h1>{state.party.name}</h1></div>
        <button className="text-button" onClick={onBack} type="button">Exit</button>
      </header>
      <main>
        <section className="admin-panel voting-panel">
          <div>
            <h2>Voting is {state.party.votingOpen ? "open" : "closed"}</h2>
            <p>Participants can update ratings while voting is open.</p>
          </div>
          <button
            className={state.party.votingOpen ? "danger-button" : "primary-button"}
            disabled={busy}
            onClick={() => void manage("toggle_voting")}
            type="button"
          >
            {state.party.votingOpen ? "Close voting" : "Reopen voting"}
          </button>
        </section>
        <section className="admin-panel">
          <h2>Add a clip</h2>
          <form className="stacked-form" onSubmit={addClip}>
            <label htmlFor="clip-title">Clip title</label>
            <input id="clip-title" maxLength={100} onChange={(event) => setTitle(event.target.value)} required value={title} />
            <label htmlFor="clip-url">YouTube URL or video ID</label>
            <input id="clip-url" onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://youtu.be/…" required value={youtubeUrl} />
            <button className="primary-button" disabled={busy} type="submit">Add clip</button>
          </form>
        </section>
        <section className="admin-panel">
          <h2>{state.clips.length} clips</h2>
          <div className="admin-clips">
            {state.clips.map((clip) => (
              <div className="admin-clip" key={clip.id}>
                <span>{clip.position}. {clip.title}</span>
                <button
                  aria-label={`Delete ${clip.title}`}
                  className="icon-button"
                  disabled={busy}
                  onClick={() => void manage("delete_clip", { id: clip.id })}
                  type="button"
                >×</button>
              </div>
            ))}
          </div>
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<PartyState | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("clips");
  const [admin, setAdmin] = useState(false);

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("get_party_state", {
        p_slug: PARTY_SLUG,
      });
      if (rpcError) throw rpcError;
      setState(data as PartyState);
      setError("");
    } catch (cause) {
      if (!silent) setError(errorMessage(cause));
      localStorage.removeItem(SESSION_KEY);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !localStorage.getItem(SESSION_KEY)) return;
    void loadState(true);
  }, [loadState]);

  useEffect(() => {
    if (!state) return;
    const timer = window.setInterval(() => void loadState(true), 10000);
    return () => window.clearInterval(timer);
  }, [loadState, state]);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await getAnonymousSession();
      const { data, error: rpcError } = await supabase.rpc("join_party", {
        p_slug: PARTY_SLUG,
        p_password: password,
      });
      if (rpcError) throw rpcError;
      localStorage.setItem(SESSION_KEY, "joined");
      setState(data as PartyState);
      setPassword("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitRating = async (clipId: string, rating: Rating) => {
    const { error: rpcError } = await supabase.rpc("rate_clip", {
      p_clip_id: clipId,
      p_funny: rating.funny,
      p_creative: rating.creative,
      p_christmas: rating.christmas,
    });
    if (rpcError) throw rpcError;
    await loadState(true);
  };

  if (!supabaseConfigured) {
    return (
      <main className="join-screen">
        <section className="join-card">
          <span className="hero-icon">🎄</span>
          <h1>One setup step left</h1>
          <p>The Supabase public key is missing. Add <code>VITE_SUPABASE_ANON_KEY</code> to the environment, then reload.</p>
        </section>
      </main>
    );
  }

  if (admin) return <Admin onBack={() => setAdmin(false)} />;

  if (!state) {
    return (
      <main className="join-screen">
        <div className="snow snow-one" /><div className="snow snow-two" />
        <section className="join-card">
          <span className="hero-icon">🎬</span>
          <span className="eyebrow">Christmas clip showdown</span>
          <h1>Ready to rate the holiday hits?</h1>
          <p className="intro">Watch the clips, score each one, and help crown the party winner.</p>
          <form onSubmit={join}>
            <label htmlFor="party-password">Party password</label>
            <input
              autoCapitalize="none"
              autoComplete="current-password"
              id="party-password"
              minLength={4}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter the secret word"
              required
              type="password"
              value={password}
            />
            <button className="primary-button" disabled={busy || !password} type="submit">
              {busy ? "Joining…" : "Join the party 🎉"}
            </button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
        <button className="text-button admin-link" onClick={() => setAdmin(true)} type="button">
          Organizer? Open controls
        </button>
      </main>
    );
  }

  const ratedCount = state.clips.filter((clip) => clip.myRating).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><span className="eyebrow">Live party</span><h1>{state.party.name}</h1></div>
        <button className="text-button" onClick={() => setAdmin(true)} type="button">⚙</button>
      </header>
      <main>
        <section className="party-progress">
          <div className="progress-copy">
            <div>
              <strong>{ratedCount} of {state.clips.length} rated</strong>
              <span>{state.party.votingOpen ? "Voting is open" : "Final results"}</span>
            </div>
            <button aria-label="Refresh scores" className="refresh-button" disabled={refreshing} onClick={() => void loadState()} type="button">↻</button>
          </div>
          <div className="progress-track">
            <span style={{ width: `${state.clips.length ? (ratedCount / state.clips.length) * 100 : 0}%` }} />
          </div>
        </section>
        <nav className="tabs" aria-label="Party views">
          <button className={tab === "clips" ? "active" : ""} onClick={() => setTab("clips")} type="button">🎬 Watch & rate</button>
          <button className={tab === "leaderboard" ? "active" : ""} onClick={() => setTab("leaderboard")} type="button">🏆 Leaderboard</button>
        </nav>
        {tab === "clips" ? (
          <section className="clip-list">
            {state.clips.length ? state.clips.map((clip) => (
              <ClipCard clip={clip} key={clip.id} onRated={submitRating} votingOpen={state.party.votingOpen} />
            )) : <p className="empty-state">The organizer hasn’t added any clips yet.</p>}
          </section>
        ) : <Leaderboard clips={state.clips} />}
        {error && <p className="form-error" role="alert">{error}</p>}
      </main>
      <footer>Made for a merry little showdown ✦</footer>
    </div>
  );
}
