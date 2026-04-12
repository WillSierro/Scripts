from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from playwright.async_api import BrowserContext, Page, async_playwright


try:
    BRAZIL_TZ = ZoneInfo("America/Sao_Paulo")
except ZoneInfoNotFoundError:
    BRAZIL_TZ = timezone(timedelta(hours=-3), name="America/Sao_Paulo")
CHAT_LIST_SELECTOR = "#gChatList"
CHAT_MESSAGE_SELECTOR = "#gChatList > li, #drawerChat #gChatList > li, li.system"
TARGET_PLAYERS = ("TheVamp", "Nuvem")
POISON_PATTERNS = ("try to poison", "tries to poison", "tried to poison")
BOSS_SPAWN_PATTERNS = ("waiting for you", "waitingforyou", "apareceu", "appeared", "spawned")
ELDER_BOSS_NAMES = {
    "first adept",
    "pain invoker",
    "first mother",
    "lost spirit",
    "abyzou",
    "shyeth",
    "the phantom",
    "soul binder",
    "shadow weaver",
}
UNIQUE_ITEM_NAMES = {
    "beast hunter",
    "blood pendant",
    "bone ripper",
    "carapace of the beast",
    "chaos wand",
    "crown of tempest",
    "death whispers",
    "destroyer",
    "dragon blade",
    "eye of the abyss",
    "fallen armor",
    "fallen heart",
    "fury blade",
    "goddess mask",
    "golden sword",
    "ice sword",
    "iron bastion",
    "mantle of oblivion",
    "mystic circlet",
    "phantom locket",
    "shroud of night",
    "soul chain",
    "supreme sword",
    "veil of shadows",
    "volcano axe",
    "wraith collar",
}
INFERNNUM_ALIASES = ("Infernnum", "Infernium")
MAX_TG_MESSAGE = 3500
UNIQUE_REPORT_HOUR_DEFAULT = 22
UNIQUE_OWNERSHIP_DAYS = 30
POLL_MESSAGES_LIMIT = 80
VIRTUS_REPORT_HOUR_DEFAULT = 19
VIRTUS_REPORT_MINUTE_DEFAULT = 30
VIRTUS_REPORT_URL = "/clans/virtus-report/17/?no-scroll=1"
VIRTUS_CLAN_PAGE_URL = "/clans/17/"
VIRTUS_PVE_TARGET = 104
VIRTUS_DUNGEON_TARGET = 96
VIRTUS_PVE_POINTS_PER_HUNT = 4
VIRTUS_IGNORE_NAMES = (
    "Llyn",
    "Lionel kanner",
    "Se ela danca, eu danco!",
)


def normalize(value: str | None) -> str:
    text = str(value or "").lower().strip()
    text = re.sub(r"\s+", " ", text)
    text = text.translate(
        str.maketrans(
            {
                "á": "a",
                "à": "a",
                "ã": "a",
                "â": "a",
                "ä": "a",
                "é": "e",
                "è": "e",
                "ê": "e",
                "ë": "e",
                "í": "i",
                "ì": "i",
                "î": "i",
                "ï": "i",
                "ó": "o",
                "ò": "o",
                "õ": "o",
                "ô": "o",
                "ö": "o",
                "ú": "u",
                "ù": "u",
                "û": "u",
                "ü": "u",
                "ç": "c",
            }
        )
    )
    return text


def normalize_token(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", normalize(value))


def cleanup(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" \t\r\n:;,-.!")


def sanitize_owner_name(value: str | None) -> str:
    return re.sub(
        r"\s*\((?:lobisomem|vampiro|werewolf|vampire)\)\s*$",
        "",
        cleanup(value),
        flags=re.I,
    )


def is_likely_owner_name(value: str | None) -> bool:
    text = cleanup(value)
    token = normalize_token(text)
    if not token:
        return False
    blocked_tokens = (
        "boss",
        "modo",
        "bonus",
        "valor",
        "sobrevivente",
        "sessoesvazias",
        "unique",
        "unico",
        "recaptcha",
        "tabela",
        "proximabatalha",
        "battlestarted",
    )
    if any(blocked in token for blocked in blocked_tokens):
        return False
    return len(text) <= 80


def format_brazil_timestamp(value: datetime) -> str:
    return value.astimezone(BRAZIL_TZ).strftime("%d/%m/%Y, %H:%M:%S")


def format_brazil_short(value: datetime) -> str:
    return value.astimezone(BRAZIL_TZ).strftime("%d/%m/%Y, %H:%M")


def brazil_now() -> datetime:
    return datetime.now(BRAZIL_TZ)


def today_key(now: datetime | None = None) -> str:
    return (now or brazil_now()).astimezone(BRAZIL_TZ).strftime("%Y-%m-%d")


def split_telegram_message(message: str) -> list[str]:
    text = str(message or "").strip()
    if not text:
        return []
    if len(text) <= MAX_TG_MESSAGE:
        return [text]
    parts: list[str] = []
    current = ""
    for line in text.splitlines():
        candidate = f"{current}\n{line}".strip() if current else line
        if len(candidate) <= MAX_TG_MESSAGE:
            current = candidate
            continue
        if current:
            parts.append(current)
        current = line
    if current:
        parts.append(current)
    return parts


def parse_virtus_value(cell: str | None) -> int:
    text = re.sub(r"\s+", " ", str(cell or "")).strip()
    values = [int(value) for value in re.findall(r"(\d+)", text)]
    return sum(values)


def parse_chat_time(time_text: str) -> datetime:
    now = brazil_now()
    match = re.match(r"^(\d{1,2}):(\d{2}):(\d{2})$", str(time_text or "").strip())
    if not match:
        return now
    event = now.replace(
        hour=int(match.group(1)),
        minute=int(match.group(2)),
        second=int(match.group(3)),
        microsecond=0,
    )
    if event - now > timedelta(hours=12):
        event -= timedelta(days=1)
    elif now - event > timedelta(hours=12):
        event += timedelta(days=1)
    return event


def parse_chat_clock(time_text: str) -> tuple[int, int, int] | None:
    match = re.match(r"^(\d{1,2}):(\d{2}):(\d{2})$", str(time_text or "").strip())
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def format_chat_timestamp(event_date: datetime, time_text: str) -> str:
    date_label = event_date.astimezone(BRAZIL_TZ).strftime("%d/%m/%Y")
    clock = parse_chat_clock(time_text)
    if clock:
        return f"{date_label}, {clock[0]:02d}:{clock[1]:02d}:{clock[2]:02d}"
    return format_brazil_timestamp(event_date)


def is_navigation_error(exc: Exception) -> bool:
    message = str(exc or "")
    return any(
        token in message
        for token in (
            "Execution context was destroyed",
            "Cannot find context with specified id",
            "Target page, context or browser has been closed",
            "Most likely the page has been closed",
        )
    )


def is_target_closed_error(exc: Exception) -> bool:
    message = str(exc or "")
    return any(
        token in message
        for token in (
            "TargetClosedError",
            "Target page, context or browser has been closed",
            "BrowserContext.close",
            "Connection closed while reading from the driver",
            "browser has been closed",
        )
    )


def loop_exception_handler(loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
    exc = context.get("exception")
    if isinstance(exc, Exception) and is_target_closed_error(exc):
        return
    loop.default_exception_handler(context)


def parse_brazilian_date_time(text: str | None) -> datetime | None:
    raw = normalize(text)
    raw = re.sub(r"\s+", " ", raw).strip()
    match = re.match(r"^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\s+as\s+(\d{1,2}):(\d{2})$", raw)
    if not match:
        return None
    months = {
        "janeiro": 1,
        "fevereiro": 2,
        "marco": 3,
        "abril": 4,
        "maio": 5,
        "junho": 6,
        "julho": 7,
        "agosto": 8,
        "setembro": 9,
        "outubro": 10,
        "novembro": 11,
        "dezembro": 12,
    }
    month = months.get(match.group(2))
    if not month:
        return None
    return datetime(
        int(match.group(3)),
        month,
        int(match.group(1)),
        int(match.group(4)),
        int(match.group(5)),
        tzinfo=BRAZIL_TZ,
    )


def create_signature(message: dict[str, Any]) -> str:
    payload = json.dumps(
        {
            "text": message.get("text", ""),
            "time_text": message.get("time_text", ""),
            "anchors": message.get("anchors", []),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def parse_clan_battle_line(raw: str) -> dict[str, str] | None:
    compact = re.sub(r"\s+", " ", str(raw or "")).strip()
    match = re.match(r"^(.+?)\s+[x×]\s+(.+?)\s*:\s*(.+)$", compact, flags=re.I)
    if not match:
        return None
    return {
        "left": cleanup(match.group(1)),
        "right": cleanup(match.group(2)),
        "detail": cleanup(match.group(3)),
        "compact": compact,
    }


def war_category_by_hour(hour: int) -> str:
    if hour in (13, 14):
        return "soldier"
    if hour in (16, 17):
        return "warrior"
    if hour in (19, 20):
        return "voivodas"
    if hour in (22, 23):
        return "elders"
    return ""


def is_infernnnum_related(text: str | None) -> bool:
    token = normalize_token(text)
    return any(
        token == normalize_token(alias)
        or normalize_token(alias) in token
        or token in normalize_token(alias)
        for alias in INFERNNUM_ALIASES
    )


@dataclass
class Config:
    project_dir: Path
    base_url: str
    monitor_url: str
    bot_token: str
    group_chat_id: str
    private_username: str
    user_data_dir: Path
    state_file: Path
    poll_interval_seconds: float
    headless: bool
    unique_report_hour: int
    virtus_report_hour: int
    virtus_report_minute: int

    @classmethod
    def load(cls, project_dir: Path) -> "Config":
        load_dotenv(project_dir / ".env")
        base_url = os.getenv("LAMENTOSA_BASE_URL", "https://pt2.lamentosa.com").rstrip("/")
        return cls(
            project_dir=project_dir,
            base_url=base_url,
            monitor_url=os.getenv("LAMENTOSA_MONITOR_URL", f"{base_url}/battlefield/enemies-g/"),
            bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
            group_chat_id=os.getenv("TELEGRAM_GROUP_CHAT_ID", "").strip(),
            private_username=os.getenv("TELEGRAM_PRIVATE_USERNAME", "Wskratos").strip().lstrip("@"),
            user_data_dir=project_dir / os.getenv("PLAYWRIGHT_USER_DATA_DIR", ".playwright-profile"),
            state_file=project_dir / os.getenv("STATE_FILE", "data/state.json"),
            poll_interval_seconds=max(1.0, float(os.getenv("POLL_INTERVAL_SECONDS", "2"))),
            headless=os.getenv("HEADLESS", "true").strip().lower() != "false",
            unique_report_hour=int(os.getenv("UNIQUE_REPORT_HOUR", str(UNIQUE_REPORT_HOUR_DEFAULT))),
            virtus_report_hour=int(os.getenv("VIRTUS_REPORT_HOUR", str(VIRTUS_REPORT_HOUR_DEFAULT))),
            virtus_report_minute=int(
                os.getenv("VIRTUS_REPORT_MINUTE", str(VIRTUS_REPORT_MINUTE_DEFAULT))
            ),
        )


@dataclass
class AppState:
    telegram_chat_id_cache: dict[str, str] = field(default_factory=dict)
    boss_alert_history: dict[str, str] = field(default_factory=dict)
    war_alert_history: dict[str, str] = field(default_factory=dict)
    unique_report_last_sent_date: str = ""
    virtus_report_last_sent_date: str = ""

    @classmethod
    def load(cls, path: Path) -> "AppState":
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return cls()
        return cls(
            telegram_chat_id_cache=dict(data.get("telegram_chat_id_cache") or {}),
            boss_alert_history=dict(data.get("boss_alert_history") or {}),
            war_alert_history=dict(data.get("war_alert_history") or {}),
            unique_report_last_sent_date=str(data.get("unique_report_last_sent_date") or ""),
            virtus_report_last_sent_date=str(data.get("virtus_report_last_sent_date") or ""),
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "telegram_chat_id_cache": self.telegram_chat_id_cache,
                    "boss_alert_history": self.boss_alert_history,
                    "war_alert_history": self.war_alert_history,
                    "unique_report_last_sent_date": self.unique_report_last_sent_date,
                    "virtus_report_last_sent_date": self.virtus_report_last_sent_date,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def prune_today(self) -> None:
        key = today_key()
        self.boss_alert_history = {k: v for k, v in self.boss_alert_history.items() if v == key}
        self.war_alert_history = {k: v for k, v in self.war_alert_history.items() if v == key}



class TelegramClient:
    def __init__(self, config: Config, state: AppState) -> None:
        self.config = config
        self.state = state

    def _request(self, method: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"https://api.telegram.org/bot{urlparse.quote(self.config.bot_token)}/{method}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urlrequest.Request(
            url,
            data=data,
            method="POST" if payload is not None else "GET",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlrequest.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urlerror.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            return {"ok": False, "description": body or str(exc)}
        except Exception as exc:
            return {"ok": False, "description": str(exc)}

    async def resolve_private_chat_id(self) -> str:
        username = normalize_token(self.config.private_username)
        if not username:
            return ""
        cached = self.state.telegram_chat_id_cache.get(username, "")
        if cached:
            return cached
        result = await asyncio.to_thread(self._request, "getUpdates")
        if result.get("ok") is False:
            print(f"[monitor] Telegram getUpdates falhou: {result.get('description')}")
            return ""
        for update in reversed(list(result.get("result") or [])):
            message = update.get("message") or update.get("edited_message") or {}
            chat = message.get("chat") or {}
            if chat.get("type") != "private":
                continue
            from_user = normalize_token((message.get("from") or {}).get("username"))
            chat_user = normalize_token(chat.get("username"))
            if username not in (from_user, chat_user):
                continue
            chat_id = str(chat.get("id") or (message.get("from") or {}).get("id") or "").strip()
            if chat_id:
                self.state.telegram_chat_id_cache[username] = chat_id
                self.state.save(self.config.state_file)
                return chat_id
        return ""

    async def send_message(self, chat_id: str, text: str, *, disable_notification: bool = False) -> dict[str, Any]:
        message_ids: list[int] = []
        for part in split_telegram_message(text):
            result = await asyncio.to_thread(
                self._request,
                "sendMessage",
                {
                    "chat_id": chat_id,
                    "text": part,
                    "disable_notification": disable_notification,
                },
            )
            if result.get("ok") is False:
                print(f"[monitor] Telegram sendMessage falhou: {result.get('description')}")
                return {"ok": False, "message_ids": message_ids}
            message_id = int((result.get("result") or {}).get("message_id") or 0)
            if message_id > 0:
                message_ids.append(message_id)
        return {"ok": True, "message_ids": message_ids}

    async def pin_message(self, chat_id: str, message_id: int) -> bool:
        result = await asyncio.to_thread(
            self._request,
            "pinChatMessage",
            {
                "chat_id": chat_id,
                "message_id": message_id,
                "disable_notification": False,
            },
        )
        if result.get("ok") is False:
            print(f"[monitor] Telegram pinChatMessage falhou: {result.get('description')}")
            return False
        return True

    async def send_group(self, text: str, *, pin: bool = False) -> bool:
        if not self.config.group_chat_id:
            return False
        result = await self.send_message(self.config.group_chat_id, text, disable_notification=False)
        if not result.get("ok"):
            return False
        if pin and result.get("message_ids"):
            await self.pin_message(self.config.group_chat_id, int(result["message_ids"][0]))
        return True

    async def send_private(self, text: str) -> bool:
        chat_id = await self.resolve_private_chat_id()
        if not chat_id:
            print(f"[monitor] Nao consegui resolver o chat_id privado de @{self.config.private_username}.")
            return False
        result = await self.send_message(chat_id, text, disable_notification=False)
        return bool(result.get("ok"))


class Monitor:
    def __init__(self, page: Page, config: Config, state: AppState, telegram: TelegramClient) -> None:
        self.page = page
        self.config = config
        self.state = state
        self.telegram = telegram
        self.processed_signatures: set[str] = set()
        self.signature_order: list[str] = []

    async def fetch_text(self, path_or_url: str) -> str:
        absolute = urlparse.urljoin(self.config.base_url + "/", path_or_url)
        return await self.page.evaluate(
            """async (targetUrl) => {
                const response = await fetch(targetUrl, { credentials: "include" });
                return await response.text();
            }""",
            absolute,
        )

    async def ensure_ready(self) -> None:
        await self.page.goto(self.config.monitor_url, wait_until="domcontentloaded")
        await self.page.wait_for_selector(CHAT_LIST_SELECTOR, timeout=60000)

    async def recover_ready(self) -> None:
        try:
            await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
        except Exception:
            pass
        try:
            await self.page.wait_for_selector(CHAT_LIST_SELECTOR, timeout=15000)
        except Exception:
            await self.page.goto(self.config.monitor_url, wait_until="domcontentloaded")
            await self.page.wait_for_selector(CHAT_LIST_SELECTOR, timeout=60000)
        await self.seed_existing()

    async def get_messages(self) -> list[dict[str, Any]]:
        return await self.page.eval_on_selector_all(
            CHAT_MESSAGE_SELECTOR,
            """(nodes) => nodes.map((node) => {
                const rootText = String(node.innerText || node.textContent || "");
                const contentNode = node.querySelector(".gc-in-msg, .gc-msg");
                const text = String(contentNode?.innerText || rootText || "").replace(/\\s+/g, " ").trim();
                const timeMatch = rootText.match(/\\b(\\d{1,2}:\\d{2}:\\d{2})\\b/);
                const anchors = Array.from(node.querySelectorAll("a")).map((anchor) => ({
                    href:
                        anchor.getAttribute("href") ||
                        anchor.getAttribute("hx-get") ||
                        anchor.getAttribute("data-href") ||
                        anchor.href ||
                        "",
                    text: String(anchor.textContent || "").replace(/\\s+/g, " ").trim(),
                }));
                return { text, time_text: timeMatch ? timeMatch[1] : "", anchors };
            })""",
        )

    def _remember(self, signature: str) -> None:
        self.processed_signatures.add(signature)
        self.signature_order.append(signature)
        while len(self.signature_order) > 4000:
            old = self.signature_order.pop(0)
            self.processed_signatures.discard(old)

    async def seed_existing(self) -> None:
        for message in await self.get_messages():
            self._remember(create_signature(message))

    async def poll(self) -> None:
        for message in (await self.get_messages())[-POLL_MESSAGES_LIMIT:]:
            signature = create_signature(message)
            if signature in self.processed_signatures:
                continue
            self._remember(signature)
            await self.handle_message(message)

    def _tracked_player(self, text: str) -> str | None:
        token = normalize_token(text)
        for player in TARGET_PLAYERS:
            if normalize_token(player) in token:
                return player
        return None

    def _poison_attempt(self, text: str) -> tuple[str, str] | None:
        raw = re.sub(r"\s+", " ", text).strip()
        match = re.match(r"(.+?)\s+(?:try|tries|tried)\s+to\s+poison\s+(.+?)(?:[.!]|$)", raw, re.I)
        if not match:
            return None
        attacker = cleanup(match.group(1)) or "Alguem"
        receiver = cleanup(match.group(2))
        target = self._tracked_player(receiver)
        return (attacker, target) if target else None

    def _dungeon_player(self, text: str) -> str | None:
        return self._tracked_player(text) if "started a new dungeon" in normalize(text) else None

    def _boss_anchor(self, message: dict[str, Any]) -> dict[str, str] | None:
        for anchor in message.get("anchors", []):
            if "/boss/" in str(anchor.get("href") or ""):
                return {"href": str(anchor.get("href") or ""), "text": cleanup(anchor.get("text"))}
        return None

    def _is_boss_announcement(self, text: str, boss_anchor: dict[str, str] | None) -> bool:
        if not boss_anchor:
            return False
        text_norm = normalize(text)
        text_token = normalize_token(text)
        return (
            "/boss/" in boss_anchor["href"]
            and "boss" in text_token
            and any(
                normalize(pattern) in text_norm or normalize_token(pattern) in text_token
                for pattern in BOSS_SPAWN_PATTERNS
            )
        )

    def _boss_category(self, text: str, boss_name: str) -> str:
        token = normalize_token(text)
        if "elder2" in token:
            return "elder2"
        if normalize(boss_name) in ELDER_BOSS_NAMES or "elder" in token:
            return "elder"
        if "soldier" in token:
            return "soldier"
        return ""

    async def _fetch_boss_info(self, boss_anchor: dict[str, str]) -> dict[str, Any]:
        fallback = cleanup(boss_anchor.get("text")) or "Boss"
        html = await self.fetch_text(boss_anchor.get("href", ""))
        soup = BeautifulSoup(html, "html.parser")
        title_node = soup.select_one(".page-title h1") or soup.select_one("h1")
        boss_name = cleanup(title_node.get_text(" ", strip=True) if title_node else fallback) or fallback
        owner_name = ""
        for node in soup.select(".lobby-info li, .l-lobby-info li, .modal-content li, .inside-info li, li, p, span, div"):
            text = cleanup(node.get_text(" ", strip=True))
            if not normalize(text).startswith("dono da sessao"):
                continue
            owner_anchor = node.select_one("a[href*='/public/']")
            candidate_owner = sanitize_owner_name(
                owner_anchor.get_text(" ", strip=True)
                if owner_anchor
                else re.sub(r"^dono da sessao\s*:?\s*", "", text, flags=re.I)
            )
            if is_likely_owner_name(candidate_owner):
                owner_name = candidate_owner
                break
        unique_haystacks = [
            normalize(" ".join(node.stripped_strings))
            for node in soup.select(".drops, .drops li, img[src*='/items/unique/']")
        ]
        if not unique_haystacks:
            unique_haystacks = [normalize(soup.get_text(" ", strip=True))]
        has_unique = any(
            re.search(r"\b(unique|unico)\b", haystack)
            or any(name in haystack for name in UNIQUE_ITEM_NAMES)
            for haystack in unique_haystacks
        )
        return {"boss_name": boss_name, "owner_name": owner_name, "has_unique": has_unique}

    async def _wait_boss_info(self, boss_anchor: dict[str, str]) -> dict[str, Any]:
        deadline = asyncio.get_running_loop().time() + 30
        latest = {"boss_name": cleanup(boss_anchor.get("text")) or "Boss", "owner_name": "", "has_unique": False}
        while asyncio.get_running_loop().time() < deadline:
            latest = await self._fetch_boss_info(boss_anchor)
            if cleanup(latest.get("owner_name")):
                return latest
            await asyncio.sleep(1)
        return latest

    async def _build_unique_report(self) -> str | None:
        html = await self.fetch_text("/items/uniques/")
        soup = BeautifulSoup(html, "html.parser")
        entries: list[dict[str, Any]] = []
        for item in soup.select(".market-items > li"):
            anchor = item.select_one("a[href*='/items/uniques/']")
            spans = item.select("div span")
            if not anchor:
                continue
            name = cleanup(spans[0].get_text(" ", strip=True) if len(spans) > 0 else "")
            slot_label = cleanup(spans[1].get_text(" ", strip=True) if len(spans) > 1 else "Item")
            slot_label = re.sub(r"\s*\((?:unico|único)\)\s*", "", slot_label, flags=re.I)
            href = cleanup(anchor.get("href"))
            if not name or not href:
                continue
            try:
                item_html = await self.fetch_text(href)
                item_soup = BeautifulSoup(item_html, "html.parser")
                table: dict[str, str] = {}
                for row in item_soup.select(".smart-table-modal li"):
                    columns = row.select("span")
                    if len(columns) < 2:
                        continue
                    table[normalize(columns[0].get_text(" ", strip=True))] = cleanup(columns[1].get_text(" ", strip=True))
                owner_anchor = item_soup.select_one(".smart-table-modal a[href*='/public/']")
                owner_name = cleanup(owner_anchor.get_text(" ", strip=True) if owner_anchor else table.get("dono")) or "Sem dono"
                is_boss_owner = normalize(owner_name).startswith("boss:")
                owned_since = parse_brazilian_date_time(table.get("dono desde"))
                expires_at = None if is_boss_owner or not owned_since else owned_since + timedelta(days=UNIQUE_OWNERSHIP_DAYS)
                entries.append(
                    {
                        "name": name,
                        "slot_label": slot_label or "Item",
                        "owner_name": owner_name,
                        "is_boss_owner": is_boss_owner,
                        "expires_at": expires_at,
                    }
                )
            except Exception as exc:
                print(f"[monitor] Falha ao ler unique {name}: {exc}")
        if not entries:
            return None
        entries.sort(
            key=lambda item: (
                item["expires_at"] is None,
                item["expires_at"] or datetime.max.replace(tzinfo=BRAZIL_TZ),
                normalize(item["name"]),
            )
        )
        emoji_by_slot = {"mao": "⚔️", "cabeca": "👑", "torso": "🛡️", "pescoco": "📿"}
        lines = [f"Relatorio de uniques {format_brazil_short(brazil_now())} (pt-BR)"]
        for item in entries:
            slot_token = normalize_token(item["slot_label"])
            emoji = next((value for key, value in emoji_by_slot.items() if key in slot_token), "✨")
            lines.append("")
            lines.append(f"{emoji} {cleanup(item['slot_label'])}: {item['name']}")
            lines.append(f"Dono: {item['owner_name']}")
            if not item["is_boss_owner"]:
                expires_label = format_brazil_short(item["expires_at"]) if item["expires_at"] else "nao consegui calcular"
                lines.append(f"Vai cair em: {expires_label}")
        return "\n".join(lines).strip()

    async def _build_virtus_report(self) -> str | None:
        html = await self.fetch_text(VIRTUS_REPORT_URL)
        soup = BeautifulSoup(html, "html.parser")
        table = soup.select_one("table.table, table.table-striped")
        if not table:
            html = await self.fetch_text(VIRTUS_CLAN_PAGE_URL)
            soup = BeautifulSoup(html, "html.parser")
            table = soup.select_one("table.table, table.table-striped")
        if not table:
            title = cleanup(
                (soup.select_one(".page-title h1") or soup.select_one("h1")).get_text(" ", strip=True)
                if soup
                else ""
            )
            if title:
                print(f"[monitor] Virtus: tabela nao encontrada. Pagina: {title}.")
            else:
                print("[monitor] Virtus: tabela nao encontrada (talvez sem acesso ao clan).")
            return None
        ignore_tokens = {normalize_token(name) for name in VIRTUS_IGNORE_NAMES if name}
        missing: list[dict[str, str]] = []
        for row in table.select("tbody tr"):
            cols = row.select("td")
            if len(cols) < 4:
                continue
            name = cleanup(cols[0].get_text(" ", strip=True))
            if normalize_token(name) in ignore_tokens:
                continue
            pve = parse_virtus_value(cols[2].get_text(" ", strip=True))
            dungeon = parse_virtus_value(cols[3].get_text(" ", strip=True))
            if not name:
                continue
            flags: list[str] = []
            if pve < VIRTUS_PVE_TARGET:
                remaining_points = max(0, VIRTUS_PVE_TARGET - pve)
                remaining_hunts = int(
                    (remaining_points + VIRTUS_PVE_POINTS_PER_HUNT - 1)
                    / VIRTUS_PVE_POINTS_PER_HUNT
                )
                flags.append(
                    f"falta fazer caçadas (pve): {remaining_hunts} ({remaining_points} pontos)"
                )
            if dungeon < VIRTUS_DUNGEON_TARGET:
                flags.append("falta fazer masmorra")
            if flags:
                missing.append({"name": name, "flags": ", ".join(flags)})
        if not missing:
            return None
        lines = [f"Relatorio Virtus {format_brazil_short(brazil_now())} (pt-BR)"]
        for entry in missing:
            lines.append(f"{entry['name']}: {entry['flags']}.")
        return "\n".join(lines).strip()

    async def maybe_send_unique_report(self) -> None:
        now = brazil_now()
        if now.hour != self.config.unique_report_hour:
            return
        if self.state.unique_report_last_sent_date == today_key(now):
            return
        message = await self._build_unique_report()
        if not message:
            return
        if await self.telegram.send_private(message):
            self.state.unique_report_last_sent_date = today_key(now)
            self.state.save(self.config.state_file)
            print("[monitor] Relatorio de uniques enviado.")

    async def maybe_send_virtus_report(self) -> None:
        now = brazil_now()
        if (
            now.hour != self.config.virtus_report_hour
            or now.minute != self.config.virtus_report_minute
        ):
            return
        if self.state.virtus_report_last_sent_date == today_key(now):
            return
        message = await self._build_virtus_report()
        if not message:
            return
        if await self.telegram.send_group(message, pin=True):
            self.state.virtus_report_last_sent_date = today_key(now)
            self.state.save(self.config.state_file)
            print("[monitor] Relatorio virtus enviado.")

    async def handle_message(self, message: dict[str, Any]) -> None:
        text = str(message.get("text") or "").strip()
        if not text:
            return
        time_text = str(message.get("time_text") or "").strip()
        event_date = parse_chat_time(time_text)
        day = today_key(event_date)

        poison = self._poison_attempt(text)
        if poison:
            attacker, target = poison
            await self.telegram.send_group(
                f"[{format_brazil_timestamp(event_date)}] {attacker} tentou envenenar {target}. "
                f"Jogar veneno novamente as {format_brazil_timestamp(event_date + timedelta(hours=2))} (pt-BR)."
            )
            print(f"[monitor] Veneno: {attacker} -> {target}")
            return

        dungeon_player = self._dungeon_player(text)
        if dungeon_player:
            await self.telegram.send_group(f"[{format_brazil_timestamp(event_date)}] {dungeon_player} abriu Dungeon.")
            print(f"[monitor] Dungeon: {dungeon_player}")
            return

        battle = parse_clan_battle_line(text)
        if battle:
            detail_token = normalize_token(battle["detail"])
            compact_token = normalize_token(battle["compact"])
            if (
                ("gvg" in detail_token or "gvg" in compact_token)
                and "battlestarted" in detail_token
                and (is_infernnnum_related(battle["left"]) or is_infernnnum_related(battle["right"]))
            ):
                chat_clock = parse_chat_clock(time_text)
                category = war_category_by_hour(chat_clock[0] if chat_clock else event_date.hour)
                if category:
                    alert_key = f"gvg|{day}|{category}|{normalize(battle['left'])}|{normalize(battle['right'])}"
                    if alert_key not in self.state.war_alert_history:
                        if await self.telegram.send_group(
                            f"[{format_chat_timestamp(event_date, time_text)}] GVG {category}: {battle['left']} x {battle['right']}.",
                            pin=True,
                        ):
                            self.state.war_alert_history[alert_key] = day
                            self.state.save(self.config.state_file)
                            print(f"[monitor] GVG: {battle['left']} x {battle['right']}")
                    return

        token = normalize_token(text)
        if ("tormentuswar" in token or re.search(r"\btw\b", text, re.I)) and is_infernnnum_related(text):
            participants = f"{battle['left']} x {battle['right']}" if battle else cleanup(text)
            alert_key = f"tw|{day}|{normalize(participants)}"
            if alert_key not in self.state.war_alert_history:
                if await self.telegram.send_group(
                    f"[{format_chat_timestamp(event_date, time_text)}] Tormentus War detectada para {participants}.",
                    pin=True,
                ):
                    self.state.war_alert_history[alert_key] = day
                    self.state.save(self.config.state_file)
                    print(f"[monitor] TW: {participants}")
            return

        boss_anchor = self._boss_anchor(message)
        if not self._is_boss_announcement(text, boss_anchor):
            return
        fallback_boss_name = cleanup((boss_anchor or {}).get("text")) or "Boss"
        category = self._boss_category(text, fallback_boss_name)
        if not category:
            return
        boss_info = await self._wait_boss_info(boss_anchor or {"href": "", "text": fallback_boss_name})
        boss_name = cleanup(boss_info.get("boss_name")) or fallback_boss_name
        owner_name = sanitize_owner_name(boss_info.get("owner_name"))
        if not owner_name:
            print(f"[monitor] Boss {boss_name} detectado, mas ainda sem dono.")
            return
        alert_key = f"{day}|{normalize(boss_name)}|{normalize(owner_name)}|{category}"
        if alert_key in self.state.boss_alert_history:
            return
        has_unique = bool(boss_info.get("has_unique"))
        if category == "soldier":
            if await self.telegram.send_private(f"O boss {boss_name} foi aberto por {owner_name}."):
                self.state.boss_alert_history[alert_key] = day
                self.state.save(self.config.state_file)
                print(f"[monitor] Boss soldier: {boss_name} / {owner_name}")
            return
        mention = f"@{self.config.private_username} " if has_unique else ""
        suffix = "e tem unique." if has_unique else "e nao tem unique."
        group_sent = await self.telegram.send_group(
            f"{mention}O boss {boss_name} foi aberto por {owner_name} {suffix}",
            pin=True,
        )
        private_sent = False
        if has_unique:
            private_sent = await self.telegram.send_private(
                f"O boss {boss_name} foi aberto por {owner_name} e tem unique."
            )
        if group_sent or private_sent:
            self.state.boss_alert_history[alert_key] = day
            self.state.save(self.config.state_file)
            print(f"[monitor] Boss {category}: {boss_name} / {owner_name} / unique={has_unique}")


async def launch_context(config: Config, *, headless: bool) -> tuple[Any, BrowserContext, Page]:
    playwright = await async_playwright().start()
    context = await playwright.chromium.launch_persistent_context(
        user_data_dir=str(config.user_data_dir),
        headless=headless,
    )
    page = context.pages[0] if context.pages else await context.new_page()
    return playwright, context, page


async def run_setup(config: Config) -> int:
    playwright, context, page = await launch_context(config, headless=False)
    try:
        await page.goto(config.monitor_url, wait_until="domcontentloaded")
        print("\n[monitor] Faça o login manualmente nessa janela.")
        print("[monitor] Quando a conta estiver logada e o chat visivel, volte aqui e aperte Enter.\n")
        await asyncio.to_thread(input)
        print(f"[monitor] Sessao salva em: {config.user_data_dir}")
        return 0
    finally:
        await context.close()
        await playwright.stop()


async def run_monitor(config: Config) -> int:
    state = AppState.load(config.state_file)
    state.prune_today()
    state.save(config.state_file)
    telegram = TelegramClient(config, state)
    while True:
        playwright = None
        context = None
        page = None
        try:
            playwright, context, page = await launch_context(config, headless=config.headless)
            monitor = Monitor(page, config, state, telegram)
            await monitor.ensure_ready()
            await monitor.seed_existing()
            print("[monitor] Chat carregado. Monitor ativo.")
            while True:
                try:
                    state.prune_today()
                    await monitor.poll()
                    await monitor.maybe_send_unique_report()
                    await monitor.maybe_send_virtus_report()
                except Exception as exc:
                    if is_navigation_error(exc):
                        print("[monitor] Navegacao detectada. Reanexando ao chat...")
                        try:
                            await monitor.recover_ready()
                            print("[monitor] Chat recarregado. Monitor retomado.")
                        except Exception as recover_exc:
                            print(f"[monitor] Falha ao retomar apos navegacao: {recover_exc}")
                    elif is_target_closed_error(exc):
                        print("[monitor] Navegador fechado. Reiniciando em 5s...")
                        break
                    else:
                        print(f"[monitor] Erro no loop: {exc}")
                await asyncio.sleep(config.poll_interval_seconds)
        except Exception as exc:
            if is_target_closed_error(exc):
                print("[monitor] Navegador fechado inesperadamente. Reiniciando em 5s...")
            else:
                print(f"[monitor] Erro fatal: {exc}")
        finally:
            try:
                if context is not None:
                    await context.close()
            except Exception:
                pass
            try:
                if playwright is not None:
                    await playwright.stop()
            except Exception:
                pass
        await asyncio.sleep(5)


async def run_test_boss(config: Config, argv: list[str]) -> int:
    state = AppState.load(config.state_file)
    telegram = TelegramClient(config, state)
    boss_name = cleanup(argv[2] if len(argv) > 2 else "Soul Binder") or "Soul Binder"
    owner_name = sanitize_owner_name(argv[3] if len(argv) > 3 else "[IFN] Kratos") or "[IFN] Kratos"
    has_unique = str(argv[4] if len(argv) > 4 else "false").strip().lower() in {
        "1",
        "true",
        "sim",
        "yes",
    }
    mention = f"@{config.private_username} " if has_unique else ""
    suffix = "e tem unique." if has_unique else "e nao tem unique."
    group_sent = await telegram.send_group(
        f"{mention}O boss {boss_name} foi aberto por {owner_name} {suffix}",
        pin=True,
    )
    private_sent = False
    if has_unique:
        private_sent = await telegram.send_private(
            f"O boss {boss_name} foi aberto por {owner_name} e tem unique."
        )
    print(
        f"[monitor] Preview enviada. Grupo={group_sent} Privado={private_sent} "
        f"Boss={boss_name} Dono={owner_name} Unique={has_unique}"
    )
    return 0 if group_sent or private_sent else 1


async def run_test_virtus(config: Config) -> int:
    state = AppState.load(config.state_file)
    telegram = TelegramClient(config, state)
    playwright = None
    context = None
    page = None
    try:
        playwright, context, page = await launch_context(config, headless=config.headless)
        monitor = Monitor(page, config, state, telegram)
        await page.goto(config.base_url, wait_until="domcontentloaded")
        print("[monitor] Buscando Virtus (preview)...")
        message = await monitor._build_virtus_report()
        if not message:
            print("[monitor] Nao encontrei dados de Virtus para enviar.")
            return 1
        if await telegram.send_group(message, pin=True):
            print("[monitor] Preview de Virtus enviada no grupo.")
            return 0
        print("[monitor] Falha ao enviar preview de Virtus.")
        return 1
    finally:
        try:
            if context is not None:
                await context.close()
        except Exception:
            pass
        try:
            if playwright is not None:
                await playwright.stop()
        except Exception:
            pass


async def run_test_gvg(config: Config) -> int:
    state = AppState.load(config.state_file)
    telegram = TelegramClient(config, state)
    playwright = None
    context = None
    page = None
    try:
        playwright, context, page = await launch_context(config, headless=config.headless)
        monitor = Monitor(page, config, state, telegram)
        await monitor.ensure_ready()
        print("[monitor] Buscando GVG no chat (teste)...")
        messages = await monitor.get_messages()
        for message in reversed(messages):
            text = str(message.get("text") or "").strip()
            if not text:
                continue
            battle = parse_clan_battle_line(text)
            if not battle:
                continue
            detail_token = normalize_token(battle["detail"])
            compact_token = normalize_token(battle["compact"])
            if not ("gvg" in detail_token or "gvg" in compact_token):
                continue
            if "battlestarted" not in detail_token:
                continue
            if not (is_infernnnum_related(battle["left"]) or is_infernnnum_related(battle["right"])):
                continue
            time_text = str(message.get("time_text") or "").strip()
            event_date = parse_chat_time(time_text)
            chat_clock = parse_chat_clock(time_text)
            category = war_category_by_hour(chat_clock[0] if chat_clock else event_date.hour)
            if not category:
                continue
            timestamp = format_chat_timestamp(event_date, time_text)
            sent = await telegram.send_group(
                f"Teste GVG: [{timestamp}] GVG {category}: {battle['left']} x {battle['right']}.",
                pin=False,
            )
            if sent:
                print("[monitor] Teste GVG enviado no grupo.")
                return 0
            print("[monitor] Falha ao enviar teste de GVG.")
            return 1
        print("[monitor] Nenhuma GVG encontrada no chat.")
        return 1
    finally:
        try:
            if context is not None:
                await context.close()
        except Exception:
            pass
        try:
            if playwright is not None:
                await playwright.stop()
        except Exception:
            pass


async def async_main(argv: list[str]) -> int:
    asyncio.get_running_loop().set_exception_handler(loop_exception_handler)
    project_dir = Path(__file__).resolve().parent
    config = Config.load(project_dir)
    command = argv[1].lower() if len(argv) > 1 else "run"
    if command == "setup":
        return await run_setup(config)
    if command == "run":
        return await run_monitor(config)
    if command == "test-boss":
        return await run_test_boss(config, argv)
    if command == "test-virtus":
        return await run_test_virtus(config)
    if command == "test-gvg":
        return await run_test_gvg(config)
    print("Uso:")
    print("  python monitor_externo\\monitor.py setup")
    print("  python monitor_externo\\monitor.py run")
    print("  python monitor_externo\\monitor.py test-boss \"Boss\" \"[TAG] Nome\" true|false")
    print("  python monitor_externo\\monitor.py test-virtus")
    print("  python monitor_externo\\monitor.py test-gvg")
    return 1


def main() -> int:
    try:
        return asyncio.run(async_main(sys.argv))
    except KeyboardInterrupt:
        print("\n[monitor] Encerrado pelo usuario.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
