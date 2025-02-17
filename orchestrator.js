#!/usr/bin/env node

import cron from 'node-cron';
import sqlite3Module from 'sqlite3';
const sqlite3 = sqlite3Module.verbose();
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
dotenv.config();

// Import the scraping scripts
import jobScraper from './job_scraper.js';
import companyScraper from './company_scraper.js';
import jobProcessor from './job_processor.js';
import initializeTables from './initializeDb.js';

// Slack configuration
const slackToken = process.env.SLACK_TOKEN;
const slackChannel = '#job-bot';
const slack = new WebClient(slackToken);

// Check if we are in dev mode via command-line flag
const devMode = process.argv.includes('--dev');

// Send Slack notification
async function sendSlackNotification(message) {
	try {
		await slack.chat.postMessage({
			channel: slackChannel,
			text: message,
			username: 'Job Scraper Bot',
		});
	} catch (error) {
		console.error('Failed to send Slack notification:', error);
	}
}

// Helper to wrap db.close in a Promise
function closeDb(db) {
	return new Promise((resolve, reject) => {
		db.close((err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

// Main orchestration function
async function runScrapingProcess() {
	const startTime = new Date();
	// Initialize stats (update these values as needed in your modules)
	let stats = { newJobs: 0, companiesScraped: 0, jobsProcessed: 0, errors: [] };

	try {
		// Create & initialize the DB, and get the open connection
		const db = await initializeTables();

		// Use a proper limit (e.g. 5 for dev mode, or Infinity for production)
		const limit = devMode ? 5 : Infinity;

        // Execute the scraping and processing modules using the same db connection.
        console.log("🚀 Starting job scraping module...");
        await jobScraper(limit, db);
        console.log("✅ Job scraping module completed.");

        console.log("🏢 Starting company scraping module...");
        await companyScraper(db);
        console.log("✅ Company scraping module completed.");

        console.log("🔧 Starting job processing module...");
        await jobProcessor(db);
        console.log("✅ Job processing module completed.");

		// (Optional) Clear temporary data after processing
		await new Promise((resolve, reject) => {
			db.run('DELETE FROM newJobLinks', (err) => (err ? reject(err) : resolve()));
		});

		// Log results to database
		await new Promise((resolve, reject) => {
			db.run(
				`INSERT INTO scraping_logs (timestamp, new_jobs, companies_scraped, jobs_processed, errors)
        VALUES (?, ?, ?, ?, ?)`,
				[startTime.toISOString(), stats.newJobs, stats.companiesScraped, stats.jobsProcessed, JSON.stringify(stats.errors)],
				(err) => {
					if (err) reject(err);
					else resolve();
				}
			);
		});

		// Close the connection once all processing and logging is done
		await closeDb(db);
		console.log('Database closed.');

		// Send Slack notification
		const message = `
🚀 Job Scraping Report (${startTime.toLocaleString()})
----------------------------------------
🆕 New jobs found: ${stats.newJobs}
🏢 Companies scraped: ${stats.companiesScraped}
🔧 Jobs processed: ${stats.jobsProcessed}
${stats.errors.length > 0 ? `\n❌ Errors encountered:\n${stats.errors.join('\n')}` : '✅ No errors encountered'}
`;
		await sendSlackNotification(message);
	} catch (error) {
		console.error('Error in scraping process:', error);
	}
}

// If in dev mode, run the process immediately
if (devMode) {
	console.log(`[${new Date().toISOString()}] Running in DEV mode: executing scraping process immediately.`);
	runScrapingProcess().catch((error) => console.error('Failed to run scraping process in dev mode:', error));
} else {
	// Schedule the job to run at 12 AM every day
	cron.schedule('0 0 * * *', () => {
		console.log(`[${new Date().toISOString()}] Starting scheduled scraping process...`);
		runScrapingProcess().catch((error) => console.error('Failed to run scraping process:', error));
	});
}

// Optionally export the process function
// export { runScrapingProcess };
