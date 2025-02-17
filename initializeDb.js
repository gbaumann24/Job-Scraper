import sqlite3Pkg from 'sqlite3';
const sqlite3 = sqlite3Pkg.verbose();
// initializeTables.js (or within orchestrator.js)
async function initializeTables() {
	return new Promise((resolve, reject) => {
		const db = new sqlite3.Database('jobs.db', (err) => {
			if (err) {
				return reject(err);
			}
			db.serialize(() => {
				// Create job_tools table
				db.run(
					`CREATE TABLE IF NOT EXISTS job_tools (
            job_id TEXT PRIMARY KEY,
            companyId TEXT,
            initialPublicationDate TEXT,
            tools TEXT
          )`,
					(err) => {
						if (err) return reject(err);
						console.log('Table job_tools created or exists.');
					}
				);

				// Create newJobLinks table
				db.run(
					`CREATE TABLE IF NOT EXISTS newJobLinks (
            id TEXT PRIMARY KEY,
            initialPublicationDate TEXT,
            companyName TEXT,
            companyId TEXT
          )`,
					(err) => {
						if (err) return reject(err);
						console.log('Table newJobLinks created or exists.');
					}
				);

				// Create companyData table
				db.run(
					`CREATE TABLE IF NOT EXISTS companyData (
            id TEXT PRIMARY KEY,
            companyName TEXT,
            industry TEXT,
            employee_count TEXT,
            founding_year TEXT,
            toplogo_file TEXT
          )`,
					(err) => {
						if (err) return reject(err);
						console.log('Table companyData created or exists.');
					}
				);

				// Create scraping_logs table
				db.run(
					`CREATE TABLE IF NOT EXISTS scraping_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            new_jobs INTEGER,
            companies_scraped INTEGER,
            jobs_processed INTEGER,
            errors TEXT
          )`,
					(err) => {
						if (err) return reject(err);
						console.log('Table scraping_logs created or exists.');
					}
				);

				// Instead of closing, resolve the open connection:
				resolve(db);
			});
		});
	});
}

export default initializeTables;
