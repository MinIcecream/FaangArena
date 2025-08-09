const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const defaultCompanies = require('./companies-data');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware with custom CSP for images
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https://img.icons8.com", "https://avatars.githubusercontent.com","https://www.google.com", "https://icons8.com", "https://upload.wikimedia.org", "https://cdn.freebiesupply.com", "https://static.alibabagroup.com", "https://encrypted-tbn0.gstatic.com", "https://yt3.googleusercontent.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves frontend from public directory

// Rate limiting for API
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Database setup
const db = new sqlite3.Database('./techarena.db');

// Initialize database tables
db.serialize(() => {
    // Companies table
    db.run(`CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        logo TEXT NOT NULL,
        score INTEGER DEFAULT 500,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Votes table
    db.run(`CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        winner_id INTEGER NOT NULL,
        loser_id INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (winner_id) REFERENCES companies (id),
        FOREIGN KEY (loser_id) REFERENCES companies (id)
    )`);

    // Insert default companies if they don't exist
    defaultCompanies.forEach(company => {
        db.run('INSERT OR IGNORE INTO companies (name, logo) VALUES (?, ?)', 
            [company.name, company.logo]);
    });

    // After inserting default companies, reset all scores to 500
    db.run('UPDATE companies SET score = 500');
});

// API Routes

// Get all companies (leaderboard)
app.get('/api/companies', (req, res) => {
    db.all('SELECT * FROM companies ORDER BY score DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
            return;
        }
        res.json(rows);
    });
});

// Get two random companies for battle
app.get('/api/battle', (req, res) => {
    db.all('SELECT * FROM companies ORDER BY RANDOM() LIMIT 2', (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
            return;
        }
        if (rows.length < 2) {
            res.status(400).json({ error: 'Not enough companies' });
            return;
        }
        res.json(rows);
    });
});

// Submit a vote
app.post('/api/vote', (req, res) => {
    const { winnerId, loserId } = req.body;
    const ip = req.ip;
    const userAgent = req.get('User-Agent');

    if (!winnerId || !loserId) {
        res.status(400).json({ error: 'Missing winner or loser ID' });
        return;
    }

    // Check if user has voted recently (rate limiting)
    db.get('SELECT COUNT(*) as count FROM votes WHERE ip_address = ? AND created_at > datetime("now", "-1 hour")', 
        [ip], (err, row) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
            return;
        }
        
        if (row.count >= 50) {
            res.status(429).json({ error: 'Too many votes. Please wait before voting again.' });
            return;
        }

        // Record the vote
        db.run('INSERT INTO votes (winner_id, loser_id, ip_address, user_agent) VALUES (?, ?, ?, ?)',
            [winnerId, loserId, ip, userAgent], function(err) {
            if (err) {
                res.status(500).json({ error: 'Database error' });
                return;
            }

            // Update scores using ELO-like system
            db.get('SELECT score FROM companies WHERE id = ?', [winnerId], (err, winner) => {
                if (err) {
                    res.status(500).json({ error: 'Database error' });
                    return;
                }

                db.get('SELECT score FROM companies WHERE id = ?', [loserId], (err, loser) => {
                    if (err) {
                        res.status(500).json({ error: 'Database error' });
                        return;
                    }

                    // Calculate score changes
                    const expectedWinner = 1 / (1 + Math.pow(10, (loser.score - winner.score) / 400));
                    const k = 32;
                    const scoreChange = Math.round(k * (1 - expectedWinner));

                    // Update scores
                    const newWinnerScore = Math.max(winner.score + scoreChange, 100);
                    const newLoserScore = Math.max(loser.score - Math.floor(scoreChange * 0.5), 100);

                    db.run('UPDATE companies SET score = ? WHERE id = ?', [newWinnerScore, winnerId]);
                    db.run('UPDATE companies SET score = ? WHERE id = ?', [newLoserScore, loserId]);

                    res.json({ 
                        success: true, 
                        scoreChange,
                        winnerScore: newWinnerScore,
                        loserScore: newLoserScore
                    });
                });
            });
        });
    });
});

// Get battle statistics
app.get('/api/stats', (req, res) => {
    db.get('SELECT COUNT(*) as totalVotes FROM votes', (err, votes) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
            return;
        }

        db.get('SELECT COUNT(*) as totalCompanies FROM companies', (err, companies) => {
            if (err) {
                res.status(500).json({ error: 'Database error' });
                return;
            }

            res.json({
                totalVotes: votes.totalVotes,
                totalCompanies: companies.totalCompanies
            });
        });
    });
});

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
    console.log(`🚀 FAANGArena server running on port ${PORT}`);
    console.log(`📱 Open your browser and go to: http://localhost:${PORT}`);
    console.log(`🛑 Press Ctrl+C to stop the server`);
    console.log('--------------------------------------------------');
}); 