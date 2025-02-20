import sqlite3Pkg from 'sqlite3';
import processJobs from './job_processor_web.js'; // adjust the path if necessary

const sqlite3 = sqlite3Pkg.verbose();
const db = new sqlite3.Database('jobs.db', (err) => {
	if (err) {
		return console.error('Fehler beim Öffnen der DB:', err.message);
	}
	console.log('Verbindung zur DB hergestellt.');
});

// Start processing jobs
processJobs(db)
	.then((jobsProcessed) => {
		console.log(`Verarbeitung abgeschlossen. ${jobsProcessed} Jobs wurden bearbeitet.`);
		db.close();
	})
	.catch((err) => {
		console.error('Fehler bei der Jobverarbeitung:', err);
		db.close();
	});
