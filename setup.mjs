// Findet automatisch deine Telegram Chat-ID und traegt sie in die .env ein.
// Voraussetzung: Token steht in .env UND du hast deinem Bot einmal geschrieben.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, ".env");

function readEnvValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error("❌ Keine .env gefunden. Bitte zuerst die .env anlegen.");
    process.exit(1);
  }
  let envText = fs.readFileSync(ENV_PATH, "utf8");
  const token = readEnvValue(envText, "TELEGRAM_BOT_TOKEN");

  if (!token) {
    console.error("\n❌ In der .env fehlt der TELEGRAM_BOT_TOKEN.");
    console.error("   Oeffne die Datei .env, fuege den Token von BotFather ein, speichere,");
    console.error("   und starte 2-setup.bat erneut.\n");
    process.exit(1);
  }

  console.log("🔎 Suche deine Chat-ID bei Telegram ...");
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const data = await res.json();

  if (!data.ok) {
    console.error(`\n❌ Telegram meldet einen Fehler: ${data.description || "unbekannt"}`);
    console.error("   Stimmt der Token in der .env? (komplett, ohne Leerzeichen)\n");
    process.exit(1);
  }

  // Letzte Nachricht mit einem Chat finden
  let chatId = null;
  let chatName = "";
  for (const upd of data.result.reverse()) {
    const msg = upd.message || upd.edited_message || upd.my_chat_member;
    if (msg && msg.chat && msg.chat.id) {
      chatId = msg.chat.id;
      chatName = msg.chat.first_name || msg.chat.title || "";
      break;
    }
  }

  if (!chatId) {
    console.error("\n⚠  Noch keine Nachricht gefunden.");
    console.error("   1) Oeffne in Telegram deinen Bot (Name, den du bei BotFather vergeben hast).");
    console.error('   2) Schreib ihm irgendeine Nachricht, z.B. "hallo".');
    console.error("   3) Starte dann 2-setup.bat nochmal.\n");
    process.exit(1);
  }

  // Chat-ID in die .env schreiben
  if (/^TELEGRAM_CHAT_ID=.*$/m.test(envText)) {
    envText = envText.replace(/^TELEGRAM_CHAT_ID=.*$/m, `TELEGRAM_CHAT_ID=${chatId}`);
  } else {
    envText += `\nTELEGRAM_CHAT_ID=${chatId}\n`;
  }
  fs.writeFileSync(ENV_PATH, envText);
  console.log(`✅ Chat-ID gefunden und gespeichert: ${chatId}${chatName ? ` (${chatName})` : ""}`);

  // Bestaetigungsnachricht senden
  const send = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "✅ Ricardo Deal Alert Bot ist verbunden! Du bekommst jetzt Benachrichtigungen bei neuen Treffern.",
    }),
  });
  if (send.ok) {
    console.log("📨 Testnachricht an dich geschickt - schau in Telegram.");
    console.log("\nFertig! Du kannst den Bot jetzt mit 3-start.bat starten.\n");
  } else {
    console.log("(Chat-ID ist gespeichert, Testnachricht konnte aber nicht gesendet werden.)");
  }
}

main().catch((e) => {
  console.error("❌ Unerwarteter Fehler:", e.message);
  process.exit(1);
});
