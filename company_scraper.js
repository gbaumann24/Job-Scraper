import sqlite3Pkg from 'sqlite3';
const sqlite3 = sqlite3Pkg.verbose();

// Mapping von Industry-ID → Branchenname (Beispielwerte)
const industryMap = {
	1: 'banken_finanzinstitute',
	2: 'baugewerbe_immobilien',
	3: 'beratung_diverse',
	4: 'bildungswesen',
	5: 'chemie_pharma',
	6: 'detail_grosshandel',
	7: 'diestleistungen_allgemein',
	8: 'energie_wasserwirtschaft',
	9: 'tourismus_reisen_freizeit',
	10: 'gesundheits_sozialwesen',
	11: 'gewerbe_handwerk_allgemein',
	12: 'industrie_diverse',
	13: 'informatik_telekommunikation',
	14: 'konsum_luxusgueterindustrie',
	15: 'land_forstwirtschaft_holz',
	16: 'maschinen_anlagenbau',
	17: 'medien_druckerei_verlag',
	18: 'medizinaltechnik',
	19: 'oeffentliche_verwaltung_verbaende',
	20: 'personalberatung',
	21: 'rechts_wirtschaftsberatung',
	22: 'tourismus_reisen_freizeit',
	23: 'transport_logistik',
	24: 'versicherungen',
};

// Hilfsfunktion: Verzögerung (z.B. 1 Sekunde)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function scrapeCompanies(db) {
	// 3) Erstelle die neue Tabelle companyData.
	//    Hier wird die Spalte "id" (Primärschlüssel) als TEXT angelegt, wobei id der companyId entspricht.
	//    Zusätzlich wird companyName aufgenommen.
	// await new Promise((resolve, reject) => {
	// 	db.run(
	// 		`CREATE TABLE companyData (
	//      id TEXT PRIMARY KEY,
	//      companyName TEXT,
	//      industry TEXT,
	//      employee_count TEXT,
	//      founding_year TEXT,
	//      toplogo_file TEXT
	//    )`,
	// 		(err) => {
	// 			if (err) return reject(err);
	// 			resolve();
	// 		}
	// 	);
	// });

	// 4) Lese alle eindeutigen Zeilen aus der newJobLinks-Tabelle
	//    Dabei werden companyId und companyName ausgelesen.
	const rows = await new Promise((resolve, reject) => {
		db.all(`SELECT DISTINCT companyId, companyName FROM newJobLinks`, (err, result) => {
			if (err) return reject(err);
			resolve(result);
		});
	});

	console.log(`Anzahl eindeutiger companyId in newJobLinks: ${rows.length}`);

	for (const row of rows) {
		const { companyId, companyName } = row;
		console.log(`\nVerarbeite companyId=${companyId} (companyName=${companyName}) ...`);

		if (!companyId) {
			console.log('Keine companyId vorhanden, überspringe...');
			continue;
		}

		// 5) Prüfe, ob dieser Datensatz bereits in companyData existiert
		const alreadyExists = await new Promise((resolve, reject) => {
			db.get(`SELECT id FROM companyData WHERE id = ?`, [companyId], (err, row) => {
				if (err) return reject(err);
				resolve(!!row);
			});
		});

		if (alreadyExists) {
			console.log(`companyId=${companyId} existiert bereits in companyData. Überspringe...`);
			continue;
		}

		// 6) Request an https://www.jobs.ch/api/v1/public/company/{companyId}
		let compData;
		try {
			const res = await fetch(`https://www.jobs.ch/api/v1/public/company/${companyId}`);
			compData = await res.json();
		} catch (err) {
			console.error(`Fehler beim Abruf für companyId=${companyId}:`, err);
			continue;
		}

		// 7) Extrahiere die gewünschten Felder:
		//    - industry (als Nummer, dann gemappt zu String)
		//    - portrait.employees -> employee_count
		//    - founding_year
		//    - toplogo_file
		const industryId = compData.industry;
		let industryString = '';
		if (industryId && industryMap[industryId]) {
			industryString = industryMap[industryId];
		}

		let employeeCount = '';
		if (compData.portrait && compData.portrait.employees) {
			employeeCount = compData.portrait.employees;
		}
		let foundingYear = compData.founding_year || '';
		let toplogoFile = compData.toplogo_file || '';

		console.log(`Gefundene Daten für companyId=${companyId}: industry="${industryString}", employees="${employeeCount}", founding_year="${foundingYear}", toplogo_file="${toplogoFile}"`);

		// 8) Füge die Daten in die Tabelle companyData ein
		await new Promise((resolve, reject) => {
			db.run(
				`INSERT INTO companyData (id, companyName, industry, employee_count, founding_year, toplogo_file)
         VALUES (?, ?, ?, ?, ?, ?)`,
				[companyId, companyName, industryString, employeeCount, foundingYear, toplogoFile],
				function (err) {
					if (err) {
						console.error(`Fehler beim Einfügen für companyId=${companyId}:`, err);
						return reject(err);
					}
					resolve();
				}
			);
		});

		// 9) Kurze Pause, um Rate Limits zu vermeiden
		await delay(1000);
	}
	return rows.length;
}


export default scrapeCompanies;
