"""Cached, deterministic Claude client. Anthropic direct or via OpenRouter.

RULE 3 says a panellist must be able to clone the repo and reproduce every
number. That is impossible with live LLM calls unless three things hold, and
this module enforces all three:

  1. temperature=0 on every call.
  2. Every response is cached on disk under a hash of exactly what was sent.
     The cache is committed.
  3. A cache hit never touches the network, so a clone with a warm cache needs
     no API key from any provider.

PROVIDERS
---------
Set either key; the provider is detected, and can be forced with
DOCTOR_LLM_PROVIDER=anthropic|openrouter.

    ANTHROPIC_API_KEY   -> api.anthropic.com, native SDK
    OPENROUTER_API_KEY  -> openrouter.ai, OpenAI-compatible

The cache key deliberately uses the CANONICAL model name rather than the
provider's slug. `claude-haiku-4.5` reached through OpenRouter and
`claude-haiku-4-5-20251001` reached directly are the same model, so a cache
populated through one provider must replay for someone holding the other --
otherwise "clone and reproduce" quietly means "clone, and also happen to have
the same vendor account I did". Which provider actually served each response
is recorded inside the entry and surfaced in the trace, so the provenance is
still visible.

Offline behaviour is explicit rather than accidental. With no key and no cache
entry, the call returns a STUB whose trace is labelled `stub` -- never
presented as model output. Every eval refuses to score stubs.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "llm_cache"

# --- canonical model names ------------------------------------------------
# These are what the cache is keyed on and what the UI displays. They are
# provider-neutral on purpose.
MODEL_FAST = os.environ.get("DOCTOR_MODEL_FAST", "claude-haiku-4.5")
MODEL_REASONING = os.environ.get("DOCTOR_MODEL_REASONING", "claude-sonnet-4.6")

#: canonical name -> provider-specific slug
SLUGS: dict[str, dict[str, str]] = {
    "claude-haiku-4.5": {
        "anthropic": "claude-haiku-4-5-20251001",
        "openrouter": "anthropic/claude-haiku-4.5",
    },
    "claude-sonnet-4.6": {
        "anthropic": "claude-sonnet-4-6",
        "openrouter": "anthropic/claude-sonnet-4.6",
    },
}

#: Published USD per million tokens. Kept in the currency the providers quote,
#: and converted once, so the FX assumption is visible rather than baked in.
PRICE_USD_PER_MTOK = {
    "claude-haiku-4.5": {"in": 1.00, "out": 5.00},
    "claude-sonnet-4.6": {"in": 3.00, "out": 15.00},
}
#: Stated, not hidden. The dashboard's cost line is approximate by this much.
USD_TO_INR = float(os.environ.get("DOCTOR_USD_INR", "88.0"))

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
ANTHROPIC_TIMEOUT = 120.0


class CacheMiss(RuntimeError):
    pass


def detect_provider() -> str | None:
    """Which provider to use. Explicit override wins, then whichever key exists."""
    forced = os.environ.get("DOCTOR_LLM_PROVIDER", "").strip().lower()
    if forced in ("anthropic", "openrouter"):
        return forced
    if os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return "anthropic"
    if os.environ.get("OPENROUTER_API_KEY", "").strip():
        return "openrouter"
    return None


def resolve_slug(canonical: str, provider: str) -> str:
    entry = SLUGS.get(canonical)
    if not entry:
        # An unknown canonical name is passed through untouched, so pinning an
        # exact slug in the environment still works.
        return canonical
    return entry.get(provider, canonical)


@dataclass
class LLMResult:
    """One call's outcome, carrying everything the trace inspector shows."""

    text: str
    parsed: Any
    model: str  # canonical name
    prompt: str
    system: str
    provider: str = "none"
    resolved_model: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    cache_hit: bool = False
    #: True when no key and no cache entry existed. Never a real answer.
    stub: bool = False
    latency_ms: int = 0

    @property
    def cost_inr(self) -> float:
        p = PRICE_USD_PER_MTOK.get(self.model)
        if not p or self.cache_hit or self.stub:
            return 0.0
        usd = (self.tokens_in * p["in"] + self.tokens_out * p["out"]) / 1_000_000
        return usd * USD_TO_INR

    @property
    def cost_inr_billable(self) -> float:
        """What these tokens cost at list price, cache or no cache.

        `cost_inr` is what was actually spent, which is zero on a cache hit.
        This is what the same call would cost without one -- the number that
        makes "we did not spend it" mean something, and the number a platform
        needs before running this over a million merchants a night.
        """
        p = PRICE_USD_PER_MTOK.get(self.model)
        if not p or self.stub:
            return 0.0
        usd = (self.tokens_in * p["in"] + self.tokens_out * p["out"]) / 1_000_000
        return usd * USD_TO_INR


@dataclass
class CallStats:
    calls: int = 0
    cache_hits: int = 0
    stubs: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    cost_inr: float = 0.0
    #: Tokens that were served from the cache rather than bought again, and
    #: what buying them would have cost. Kept apart from the spent figures so
    #: the two can never be added together by accident.
    tokens_in_saved: int = 0
    tokens_out_saved: int = 0
    cost_inr_saved: float = 0.0
    per_model: dict = field(default_factory=dict)

    def record(self, r: LLMResult) -> None:
        self.calls += 1
        self.cache_hits += int(r.cache_hit)
        self.stubs += int(r.stub)
        if r.cache_hit:
            self.tokens_in_saved += r.tokens_in
            self.tokens_out_saved += r.tokens_out
            self.cost_inr_saved += r.cost_inr_billable
        else:
            self.tokens_in += r.tokens_in
            self.tokens_out += r.tokens_out
            self.cost_inr += r.cost_inr
        self.per_model[r.model] = self.per_model.get(r.model, 0) + 1

    @property
    def cache_hit_rate(self) -> float:
        return self.cache_hits / self.calls if self.calls else 0.0

    @property
    def tokens_total(self) -> int:
        """Every token the run needed, bought or not."""
        return (
            self.tokens_in
            + self.tokens_out
            + self.tokens_in_saved
            + self.tokens_out_saved
        )


def _key(model: str, system: str, prompt: str, schema_name: str) -> str:
    """Cache key. Canonical model name only -- see the module docstring."""
    blob = json.dumps(
        {"model": model, "system": system, "prompt": prompt, "schema": schema_name},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def extract_json(text: str) -> Any:
    """Pull the first JSON object out of a response.

    Models sometimes wrap JSON in prose or a fenced block even when told not
    to. Failing a whole run over a stray "Here you go:" would be silly, so we
    look for a fence first, then the outermost balanced braces.
    """
    fenced = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fenced:
        text = fenced.group(1)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, depth = None, 0
    for i, ch in enumerate(text):
        if ch == "{":
            if start is None:
                start = i
            depth += 1
        elif ch == "}" and start is not None:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    start, depth = None, 0
    raise ValueError("no JSON object found in response: %r" % text[:200])


class LLMClient:
    """Cache in front, Anthropic or OpenRouter behind."""

    def __init__(
        self,
        cache_dir: Path = CACHE_DIR,
        *,
        allow_network: bool = True,
        offline_stub=None,
        provider: str | None = None,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.provider = provider or detect_provider()
        self.api_key = (
            os.environ.get("ANTHROPIC_API_KEY", "").strip()
            if self.provider == "anthropic"
            else os.environ.get("OPENROUTER_API_KEY", "").strip()
            if self.provider == "openrouter"
            else ""
        )
        self.allow_network = allow_network and bool(self.api_key)
        #: fn(schema_name, prompt) -> dict, used only when offline.
        self.offline_stub = offline_stub
        self.stats = CallStats()
        #: Reused across calls. A fresh connection per completion pays for a
        #: TLS handshake every time, which is small next to the routing fix
        #: above but free to avoid.
        self._http = None
        self._anthropic = None

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)

    def describe(self) -> str:
        if not self.has_key:
            return "no key (cache-only)"
        return "%s" % self.provider

    # --- provider calls ---------------------------------------------------

    def _call_anthropic(self, system: str, prompt: str, slug: str, max_tokens: int):
        if self._anthropic is None:
            from anthropic import Anthropic

            self._anthropic = Anthropic(api_key=self.api_key, timeout=ANTHROPIC_TIMEOUT)
        resp = self._anthropic.messages.create(
            model=slug,
            max_tokens=max_tokens,
            temperature=0,  # RULE 3
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return text, resp.usage.input_tokens, resp.usage.output_tokens

    def _call_openrouter(self, system: str, prompt: str, slug: str, max_tokens: int):
        """One completion through OpenRouter.

        The provider is pinned, and that single line is worth 9x. OpenRouter
        picks a backend for you, and left to itself it was routing Haiku calls
        to one that took twelve seconds to return eighty tokens -- so the
        assistant sat on "thinking" long enough to look broken. Naming
        Anthropic first brings the same call back in 1.5s. Fallbacks stay
        ALLOWED: preferring a fast provider is worth a lot, and refusing to
        answer at all when it is busy is not.
        """
        import httpx

        if self._http is None:
            self._http = httpx.Client(timeout=ANTHROPIC_TIMEOUT)

        r = self._http.post(
            OPENROUTER_URL,
            timeout=ANTHROPIC_TIMEOUT,
            headers={
                "Authorization": "Bearer %s" % self.api_key,
                "Content-Type": "application/json",
                # OpenRouter attribution headers; harmless and good manners.
                "HTTP-Referer": "https://github.com/2005-Aneeshdutt",
                "X-Title": "Revenue Doctor",
            },
            json={
                "model": slug,
                "temperature": 0,  # RULE 3
                "max_tokens": max_tokens,
                "provider": {"order": ["Anthropic"]},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        if r.status_code != 200:
            raise RuntimeError(
                "OpenRouter %d: %s" % (r.status_code, r.text[:400])
            )
        data = r.json()
        if "choices" not in data:
            raise RuntimeError("OpenRouter returned no choices: %s" % str(data)[:400])
        text = data["choices"][0]["message"]["content"] or ""
        usage = data.get("usage") or {}
        return text, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)

    # --- the one entry point ---------------------------------------------

    def complete(
        self,
        *,
        system: str,
        prompt: str,
        model: str,
        schema_name: str,
        max_tokens: int = 1024,
    ) -> LLMResult:
        key = _key(model, system, prompt, schema_name)
        path = self.cache_dir / (key + ".json")

        if path.exists():
            blob = json.loads(path.read_text(encoding="utf-8"))
            r = LLMResult(
                text=blob["text"],
                parsed=extract_json(blob["text"]),
                model=model,
                prompt=prompt,
                system=system,
                provider=blob.get("provider", "unknown"),
                resolved_model=blob.get("resolved_model", ""),
                tokens_in=blob.get("tokens_in", 0),
                tokens_out=blob.get("tokens_out", 0),
                cache_hit=True,
            )
            self.stats.record(r)
            return r

        if not self.allow_network:
            if self.offline_stub is None:
                raise CacheMiss(
                    "no cache entry for %s and no API key set.\n"
                    "Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY to populate "
                    "the cache, or pass an offline_stub." % key[:12]
                )
            stub = self.offline_stub(schema_name, prompt)
            r = LLMResult(
                text=json.dumps(stub),
                parsed=stub,
                model=model,
                prompt=prompt,
                system=system,
                provider="none",
                stub=True,
            )
            self.stats.record(r)
            return r

        slug = resolve_slug(model, self.provider)
        t0 = time.time()
        if self.provider == "openrouter":
            text, tin, tout = self._call_openrouter(system, prompt, slug, max_tokens)
        else:
            text, tin, tout = self._call_anthropic(system, prompt, slug, max_tokens)
        latency = int((time.time() - t0) * 1000)

        path.write_text(
            json.dumps(
                {
                    "model": model,
                    "provider": self.provider,
                    "resolved_model": slug,
                    "schema": schema_name,
                    "system": system,
                    "prompt": prompt,
                    "text": text,
                    "tokens_in": tin,
                    "tokens_out": tout,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8", newline="\n",
        )
        r = LLMResult(
            text=text,
            parsed=extract_json(text),
            model=model,
            prompt=prompt,
            system=system,
            provider=self.provider,
            resolved_model=slug,
            tokens_in=tin,
            tokens_out=tout,
            latency_ms=latency,
        )
        self.stats.record(r)
        return r
