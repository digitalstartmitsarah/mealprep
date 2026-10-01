// Netlify Function (Schritt 2 von 2): bekommt den fertigen Wochenplan aus
// meal-prep.js zurückgeschickt und erzeugt dazu passend die Einkaufsliste
// und ein paar kurze Tipps. Läuft als eigener, schneller Aufruf, damit die
// Gesamtanfrage nicht am Zeitlimit von Netlify scheitert.
// Benötigt dieselbe Umgebungsvariable ANTHROPIC_API_KEY.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let answers, wochenplan;
  try {
    const body = JSON.parse(event.body || "{}");
    answers = body.answers || {};
    wochenplan = body.wochenplan || [];
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Ungültige Anfrage" }) };
  }

  const format = (label, value) => {
    if (Array.isArray(value)) {
      return value.length ? `${label}: ${value.join(", ")}` : null;
    }
    if (value && value.toString().trim().length > 0) {
      return `${label}: ${value}`;
    }
    return null;
  };

  const gerichte = [];
  wochenplan.forEach((tag) => {
    (tag.mahlzeiten || []).forEach((m) => {
      gerichte.push(`${tag.tag}, ${m.typ}: ${m.name}${m.beschreibung ? ", " + m.beschreibung : ""}`);
    });
  });

  const lines = [
    format("Allergien oder Unverträglichkeiten", answers.unvertraeglichkeiten),
    format("Zutaten, die gemieden werden sollen", answers.nicht_mag),
    format("Anzahl Personen", answers.personen),
    format("Bevorzugter Prep Stil", answers.prep_stil),
    format("Vorhandene Küchengeräte", answers.kuechenausstattung),
    format("Budget", answers.budget),
    format("Resteverwertung gewünscht", answers.reste),
    "",
    "Geplante Gerichte:",
    gerichte.join("\n"),
  ].filter((l) => l !== null);

  const userContent = lines.join("\n");

  const systemPrompt = `Du bekommst einen bereits fertigen Meal Prep Wochenplan mit den geplanten Gerichten. Erstelle dazu eine passende Einkaufsliste und ein paar kurze Tipps.

Antworte ausschließlich mit einem validen JSON Objekt, ohne Markdown, ohne Codeblock, ohne einleitenden Text, in genau dieser Struktur:

{
  "einkaufsliste": [
    {"kategorie": "Obst und Gemüse", "items": ["Zutat 1", "Zutat 2"]},
    {"kategorie": "Kühlregal", "items": ["..."]},
    {"kategorie": "Vorratsschrank", "items": ["..."]}
  ],
  "prep_tipps": ["Konkreter Tipp, wie am Wochenende oder vorab effizient vorbereitet werden kann, abgestimmt auf den gewählten Prep Stil", "..."],
  "tipps": ["Ein bis zwei weitere hilfreiche Tipps passend zu Budget oder Küchenausstattung"]
}

Die Einkaufsliste muss zu den tatsächlich genannten Gerichten passen, keine Zutaten auflisten, die in keinem Gericht vorkommen. Berücksichtige Allergien, Unverträglichkeiten und gemiedene Zutaten unbedingt. Richte die Mengen grob nach der Anzahl Personen. Schreib in einem warmen, direkten Du Ton, ohne Gedankenstriche, ohne Floskeln.

Wichtig für Tempo und Länge: Fass dich sehr kurz. Maximal 3 prep_tipps und maximal 2 tipps, jeweils ein kurzer Satz.`;

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1800,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: "API Fehler", detail: errText }) };
    }

    const apiData = await apiRes.json();
    const rawText = (apiData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    let cleaned = rawText.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace > -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "Konnte Ergebnis nicht lesen" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Serverfehler", detail: err.message }) };
  }
};
