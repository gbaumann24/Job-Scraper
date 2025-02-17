import sqlite3Pkg from 'sqlite3';
const sqlite3 = sqlite3Pkg.verbose();
import { URLSearchParams } from 'url';

/**
 * Formatiert ein Date-Objekt in das Format "YYYY-MM-DD HH:mm:ss"
 */
function formatDate(date) {
	const yyyy = date.getFullYear();
	const MM = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const HH = String(date.getHours()).padStart(2, '0');
	const mm = String(date.getMinutes()).padStart(2, '0');
	const ss = String(date.getSeconds()).padStart(2, '0');
	return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
}

/**
 * Führt den Scraping-Prozess durch:
 * 1. Setzt den Datumsbereich gemäß jobs.ch-Filter: von gestern 00:00:00 bis heute 23:59:59.
 * 2. Ermittelt mit einem ersten Request die Anzahl der Seiten.
 * 3. Paginiert durch alle Seiten und speichert die relevanten Felder in einer SQLite-Datenbank.
 *
 * @param {number} amount - Maximale Anzahl an Jobs, die verarbeitet werden sollen.
 */
async function jobScraper(amount = Infinity, db) {
	// Öffne bzw. erstelle die lokale SQLite-Datenbank

	// Erstelle die Tabelle, falls sie noch nicht existiert
	// 	db.run(`CREATE TABLE IF NOT EXISTS newJobLinks (
	//     id TEXT PRIMARY KEY,
	//     initialPublicationDate TEXT,
	//     companyName TEXT,
	//     companyId TEXT
	//   )`);

	// Setze den Datumsbereich wie auf jobs.ch:
	// publicationDateFrom: gestriger Tag um 00:00:00
	// publicationDateTo: heutiger Tag um 23:59:59
	const now = new Date();
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	yesterday.setHours(0, 0, 0, 0);

	const endOfToday = new Date(now);
	endOfToday.setHours(23, 59, 59, 0);

	const publicationDateFrom = formatDate(yesterday);
	const publicationDateTo = formatDate(endOfToday);

	// Basisparameter für die API
	const baseUrl = 'https://job-search-api.jobs.ch/search';
	const rows = 100;
	let params = new URLSearchParams({
		page: '1',
		publicationDateFrom,
		publicationDateTo,
		rows: rows.toString(),
	});

	console.log('Erster Request, um die Gesamtzahl der Seiten zu ermitteln …');
	const response = await fetch(`${baseUrl}?${params.toString()}`);
	const data = await response.json();
	const numPages = data.numPages || 1;
	console.log(`Es wurden ${numPages} Seite(n) gefunden.`);

	let jobsScraped = 0;
	// outer: Label to break out of both loops when limit reached
	outer: for (let page = 1; page <= numPages; page++) {
		params.set('page', page.toString());
		console.log(`Hole Seite ${page} von ${numPages} …`);
		const res = await fetch(`${baseUrl}?${params.toString()}`);
		const pageData = await res.json();
		console.log(`${baseUrl}?${params.toString()}`);

		const documents = pageData.documents;
		if (documents && documents.length > 0) {
			documents.forEach((doc) => {
				if (jobsScraped >= amount) {
					return; // This returns from the forEach callback; we use break outer below.
				}
				const jobId = doc.id;
				const initialPublicationDate = doc.initialPublicationDate;
				const companyName = doc.company && doc.company.name ? doc.company.name : null;
				const companyId = doc.company && doc.company.id ? doc.company.id : null;

				// INSERT OR IGNORE, um doppelte Einträge zu vermeiden
				db.run(
					`INSERT OR IGNORE INTO newJobLinks (id, initialPublicationDate, companyName, companyId) VALUES (?, ?, ?, ?)`,
					[jobId, initialPublicationDate, companyName, companyId],
					function (err) {
						if (err) {
							console.error('Fehler beim Einfügen in die DB:', err);
						}
					}
				);
				jobsScraped++;
			});
			if (jobsScraped >= amount) {
				console.log(`Limit von ${amount} Jobs erreicht.`);
				break outer;
			}
		} else {
			console.log(`Keine Jobs auf Seite ${page} gefunden.`);
		}
	}

	// Return a summary object
	return { jobsScraped };
}

// jobScraper()
// 	.then(() => console.log('Scraping abgeschlossen.'))
// 	.catch((err) => console.error('Fehler beim Scraping:', err));

export default jobScraper;
