import sqlite3Pkg from 'sqlite3';
import dotenv from 'dotenv';
const sqlite3 = sqlite3Pkg.verbose();

// OpenAI API-Key
dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Hilfsfunktion: Verzögerung (z. B. um Rate Limits zu berücksichtigen)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processJobs(db) {
	console.log(`[${new Date().toISOString()}] Starte Jobverarbeitung...`);

	// Lese alle Zeilen aus der bestehenden jobs-Tabelle
	const jobs = await new Promise((resolve, reject) => {
		db.all(`SELECT id AS job_id, companyId, initialPublicationDate FROM newJobLinks`, (err, rows) => {
			if (err) {
				console.error(`[${new Date().toISOString()}] Fehler beim Lesen der Joblinks:`, err);
				return reject(err);
			}
			resolve(rows);
		});
	});

	console.log(`[${new Date().toISOString()}] Gefundene Jobs: ${jobs.length}`);

	let jobs_processed = 0;
	// Für jeden Job...
	for (const job of jobs) {
		jobs_processed++;
		const { job_id, companyId, initialPublicationDate } = job;
		console.log(`\n[${new Date().toISOString()}] ------------------------------`);
		console.log(`[${new Date().toISOString()}] Verarbeite Job ${job_id} (Company: ${companyId}, Datum: ${initialPublicationDate}) ...`);

		// 1. Hole die Jobdetails
		let jobDetails;
		try {
			console.log(`[${new Date().toISOString()}] Hole Jobdetails von https://www.jobs.ch/api/v1/public/search/job/${job_id}`);
			const jobRes = await fetch(`https://www.jobs.ch/api/v1/public/search/job/${job_id}`);
			jobDetails = await jobRes.json();
			console.log(`[${new Date().toISOString()}] Jobdetails erfolgreich abgerufen.`);
		} catch (err) {
			console.error(`[${new Date().toISOString()}] Fehler beim Abruf der Jobdetails für ${job_id}:`, err);
			continue;
		}

		// 2. Extrahiere den template_text
		const templateText = jobDetails.template_text;
		if (!templateText) {
			console.log(`[${new Date().toISOString()}] Kein template_text für Job ${job_id} gefunden.`);
			continue;
		} else {
			console.log(`[${new Date().toISOString()}] template_text gefunden, Länge: ${templateText.length} Zeichen.`);
		}

		// 3. Erstelle den angepassten Prompt
		const prompt =
			'Dies ist eine Jobbeschreibung von jobs.ch. Analysiere den Text und extrahiere ausschließlich die Namen von konkreten, marktüblichen Softwarelösungen, Tools oder Programmen, die im Text genannt werden und die das Unternehmen tatsächlich verwendet. ' +
			'Berücksichtige dabei nur eindeutig als Software/Tool/Programm identifizierbare Nennungen. ' +
			'Falls es sich um eine Programmiersprache handelt, setze den booleschen Wert "code" auf true, andernfalls auf false. ' +
			'Bestimme außerdem aus dem <h1>, für welche Position (z. B. "Entwicklung", "Marketing", etc.) das Tool eingesetzt werden soll und gib diese als "position" zurück. ' +
			'Der Output muss exakt folgendem JSON-Format entsprechen: {"position": "<Position>", "tools": [{"name": "<Toolname>", "code": <true/false>}, ...]}. ' +
			'Validiere die Ausgabe streng auf diese Struktur. Falls keine entsprechenden Tools gefunden werden, gib {"position": "", "tools": []} zurück.' +
			'\n\nJob Beschreibung:\n' +
			templateText;
		console.log(`[${new Date().toISOString()}] Prompt erstellt.`);

		// 4. Sende den template_text an die OpenAI API, um Tools zu extrahieren.
		let openaiResult;
		try {
			console.log(`[${new Date().toISOString()}] Sende Anfrage an OpenAI API für Job ${job_id} ...`);
			const openaiResponse = await fetch('https://litellm.sph-prod.ethz.ch/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${OPENAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: 'gpt-4o',
					messages: [{ role: 'user', content: prompt }],
					temperature: 0, // deterministische Ausgabe
				}),
			});
			const openaiJson = await openaiResponse.json();
			openaiResult = openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message && openaiJson.choices[0].message.content;
			console.log(`[${new Date().toISOString()}] OpenAI API Antwort erhalten.`);
		} catch (err) {
			console.error(`[${new Date().toISOString()}] Fehler beim Aufruf der OpenAI API für Job ${job_id}:`, err);
			continue;
		}

		if (!openaiResult) {
			console.log(`[${new Date().toISOString()}] Keine Tools-Antwort von OpenAI für Job ${job_id}.`);
			continue;
		}

		// 5. Bereinige den OpenAI-Antworttext von Markup (z.B. ```javascript ... ```) und entferne einen optionalen "json"-Präfix
		let cleanedToolsString = openaiResult
			.replace(/```(javascript)?\s*/gi, '')
			.replace(/```/g, '')
			.trim();
		if (cleanedToolsString.toLowerCase().startsWith('json')) {
			cleanedToolsString = cleanedToolsString.replace(/^json\s*/i, '');
		}

		console.log(`[${new Date().toISOString()}] OpenAI Antwort bereinigt:\n${cleanedToolsString}`);

		// 6. Versuche, den bereinigten String als JSON zu parsen und validiere die Output-Struktur.
		let extractedData;
		try {
			extractedData = JSON.parse(cleanedToolsString);
			// Validierung: Es muss ein Objekt mit den Schlüsseln "position" und "tools" vorliegen,
			// wobei "tools" ein Array ist.
			if (typeof extractedData !== 'object' || extractedData === null || !('position' in extractedData) || !('tools' in extractedData) || !Array.isArray(extractedData.tools)) {
				throw new Error('Output-Struktur ungültig: Fehlende erforderliche Schlüssel.');
			}
			// Validierung: "position" muss ein String sein.
			if (typeof extractedData.position !== 'string') {
				throw new Error('Output-Struktur ungültig: "position" muss ein String sein.');
			}
			// Validierung: Jedes Element in "tools" muss ein Objekt mit "name" (String) und "code" (Boolean) sein.
			for (const tool of extractedData.tools) {
				if (typeof tool !== 'object' || tool === null || !('name' in tool) || !('code' in tool) || typeof tool.name !== 'string' || typeof tool.code !== 'boolean') {
					throw new Error('Output-Struktur ungültig: Jedes Tool muss ein Objekt mit "name" (String) und "code" (Boolean) sein.');
				}
			}
			console.log(`[${new Date().toISOString()}] Validierte Tools für Job ${job_id}: ${JSON.stringify(extractedData)}`);
		} catch (err) {
			console.error(`[${new Date().toISOString()}] Ungültige Ausgabe für Job ${job_id}:`, err.message);
			continue;
		}

		// 7. Konvertiere die validierten Daten in einen String zur Speicherung in der Datenbank.
		const finalToolsString = JSON.stringify(extractedData);
		console.log(`[${new Date().toISOString()}] Finaler Tools-String für Job ${job_id} erstellt.`);

		// 8. Speichere die validierten Tools in der neuen Tabelle
		try {
			await new Promise((resolve, reject) => {
				db.run(
					`INSERT OR REPLACE INTO job_tools (job_id, companyId, initialPublicationDate, tools) VALUES (?, ?, ?, ?)`,
					[job_id, companyId, initialPublicationDate, finalToolsString],
					function (err) {
						if (err) {
							console.error(`[${new Date().toISOString()}] Fehler beim Speichern für Job ${job_id}:`, err);
							return reject(err);
						}
						resolve();
					}
				);
			});
			console.log(`[${new Date().toISOString()}] Tools für Job ${job_id} erfolgreich in der DB gespeichert.`);
		} catch (err) {
			console.error(`[${new Date().toISOString()}] DB-Speicherfehler für Job ${job_id}:`, err);
			continue;
		}

		// Optional: Kurze Pause, um Rate Limits zu schonen
		console.log(`[${new Date().toISOString()}] Warte 4 Sekunden vor dem nächsten Job...`);
		await delay(4000);
	}

	return jobs_processed;
}

export default processJobs;
