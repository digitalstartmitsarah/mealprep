// Netlify Function: nimmt die Quiz-Antworten entgegen, ruft die Anthropic API auf
// und gibt einen strukturierten, individuellen Meal-Prep-Wochenplan als JSON zurück.
// Benötigt die Umgebungsvariable ANTHROPIC_API_KEY in den Netlify Site Settings.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let answers;
  try {
    const body = JSON.parse(event.body || "{}");
    answers = body.answers || {};
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

  const lines = [
    format("Hauptziel", answers.ziel),
    format("Ernährungsform", answers.ernaehrungsform),
    format("Allergien oder Unverträglichkeiten", answers.unvertraeglichkeiten),
    format("Lieblingszutaten oder Lieblingsgerichte", answers.lieblingszutaten),
    format("Zutaten, die gemieden werden sollen", answers.nicht_mag),
    format("Anzahl Personen", answers.personen),
    format("Anzahl Tage für den Plan", answers.tage),
    format("Gewünschte Mahlzeiten", answers.mahlzeiten),
    format("Verfügbare Kochzeit pro Tag", answers.kochzeit),
    format("Bevorzugter Prep Stil", answers.prep_stil),
    format("Vorhandene Küchengeräte", answers.kuechenausstattung),
    format("Budget", answers.budget),
    format("Bevorzugte Geschmacksrichtungen", answers.kueche_stil),
    format("Resteverwertung gewünscht", answers.reste),
  ].filter(Boolean);

  const userContent = lines.join("\n");

  const systemPrompt = `Du erstellst für eine Person einen individuellen Meal Prep Wochenplan basierend auf ihren Antworten aus einem Fragebogen.

Antworte ausschließlich mit einem validen JSON Objekt, ohne Markdown, ohne Codeblock, ohne einleitenden Text, in genau dieser Struktur:

{
  "titel": "Kurzer, konkreter Titel für diesen Plan, kein Gedankenstrich verwenden",
  "intro": "2 bis 3 Sätze, warum dieser Plan zu ihren Angaben passt",
  "wochenplan": [
    {
      "tag": "Tag 1",
      "mahlzeiten": [
        {"typ": "Frühstück", "name": "Name des Gerichts", "beschreibung": "Kurze, konkrete Beschreibung in einem halben Satz", "zubereitung": "Zubereitung in 2 bis 4 kurzen, nummerierten Schritten, durch Zeilenumbruch getrennt, praxistauglich und einfach"},
        {"typ": "Mittag", "name": "...", "beschreibung": "...", "zubereitung": "..."}
      ]
    }
  ],
  "einkaufsliste": [
    {"kategorie": "Obst und Gemüse", "items": ["Zutat 1", "Zutat 2"]},
    {"kategorie": "Kühlregal", "items": ["..."]},
    {"kategorie": "Vorratsschrank", "items": ["..."]}
  ],
  "prep_tipps": ["Konkreter Tipp, wie am Wochenende oder vorab effizient vorbereitet werden kann, abgestimmt auf den gewählten Prep Stil", "..."],
  "tipps": ["Ein bis zwei weitere hilfreiche Tipps passend zu Ziel, Budget oder Küchenausstattung"]
}

Nur die Mahlzeiten einplanen, die ausdrücklich gewünscht wurden. Die Anzahl der Tage im Wochenplan muss genau der gewählten Anzahl Tage entsprechen. Die Einkaufsliste muss zu den tatsächlich verwendeten Zutaten im Wochenplan passen, keine Zutaten auflisten, die nirgendwo im Plan vorkommen. Berücksichtige Allergien, Unverträglichkeiten und gemiedene Zutaten unbedingt, verwende niemals Zutaten, die ausgeschlossen wurden. Richte dich nach dem angegebenen Budget und der verfügbaren Kochzeit. Schreib in einem warmen, direkten Du Ton, ohne Gedankenstriche, ohne Floskeln. Sei konkret statt allgemein, erfinde keine Fakten über die Person, die nicht aus ihren Antworten hervorgehen.

Wichtig für Tempo und Länge: Fass dich kurz. Jede Beschreibung einer Mahlzeit ist maximal ein halber Satz, kein ganzer Absatz. Die Zubereitung pro Mahlzeit hat maximal 4 kurze Schritte, keine langen Erklärungen pro Schritt. Namen der Gerichte kurz halten. Maximal 3 prep_tipps und maximal 2 tipps. Keine langen Erklärungen, direkt auf den Punkt.`;

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
        max_tokens: 4500,
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

    // Falls vor oder nach dem JSON noch zusätzlicher Text steht, nur den Teil
    // zwischen der ersten { und der letzten } verwenden.
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace > -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      const truncated = apiData.stop_reason === "max_tokens";
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: truncated
            ? "Antwort war zu lang und wurde abgeschnitten"
            : "Konnte Ergebnis nicht lesen",
        }),
      };
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
