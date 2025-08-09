// TechArena - Software Company Rankings
class TechArena {
    constructor() {
        this.companies = [];
        this.currentBattle = { company1: null, company2: null };
        this.apiBase = '/api';
        this.lastVoteTime = 0; // Track last vote time for cooldown
        this.voteCooldown = 1000; // 1 second cooldown in milliseconds
        
        this.init();
    }

    init() {
        this.loadCompanies().then(() => this.updateLeaderboard());
        this.setupEventListeners();
        this.startNewBattle();
    }

    // Load companies from API
    async loadCompanies() {
        try {
            const response = await fetch(`${this.apiBase}/companies`);
            if (!response.ok) {
                throw new Error('Failed to load companies');
            }
            this.companies = await response.json();
        } catch (error) {
            console.error('Error loading companies:', error);
            this.showNotification('Failed to load companies. Please refresh the page.', 'error');
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Navigation
        document.getElementById('leaderboardBtn').addEventListener('click', () => this.showView('leaderboard'));
        document.getElementById('battleBtn').addEventListener('click', () => this.showView('battle'));

        // Voting
        document.querySelectorAll('.vote-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleVote(e));
        });

        // Shuffle
        document.getElementById('shuffleBtn').addEventListener('click', () => this.shuffleBattle());
    }

    // Show/hide views
    showView(viewName) {
        // Update navigation buttons
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        if (viewName === 'leaderboard') {
            document.getElementById('leaderboardBtn').classList.add('active');
        } else {
            document.getElementById('battleBtn').classList.add('active');
        }

        // Show/hide views
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        if (viewName === 'leaderboard') {
            document.getElementById('leaderboardView').classList.add('active');
            this.loadCompanies().then(() => this.updateLeaderboard());
        } else {
            document.getElementById('battleView').classList.add('active');
            if (!this.currentBattle.company1 || !this.currentBattle.company2) {
                this.startNewBattle();
            }
        }
    }

    // Update leaderboard display
    updateLeaderboard() {
        const leaderboardList = document.getElementById('leaderboardList');
        
        // Sort companies by score (descending)
        const sortedCompanies = [...this.companies].sort((a, b) => b.score - a.score);
        
        leaderboardList.innerHTML = sortedCompanies.map((company, index) => {
            // Always show points, even if 500
            const scoreDisplay = `${company.score} points`;
            return `
                <div class="leaderboard-item">
                    <div class="rank">#${index + 1}</div>
                    <div class="logo-container">
                        <img src="${company.logo}" alt="${company.name}" class="logo" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="logo-fallback" style="display: none;">
                            <span>${company.name.charAt(0)}</span>
                        </div>
                    </div>
                    <div class="info">
                        <div class="name">${company.name}</div>
                        <div class="score">${scoreDisplay}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Start a new battle with API
    async startNewBattle() {
        try {
            const response = await fetch(`${this.apiBase}/battle`);
            if (!response.ok) {
                throw new Error('Failed to get battle companies');
            }
            const battleCompanies = await response.json();
            
            if (battleCompanies.length >= 2) {
                this.currentBattle = { 
                    company1: battleCompanies[0], 
                    company2: battleCompanies[1] 
                };
                this.updateBattleDisplay();
            } else {
                this.showNotification('Not enough companies for battle!', 'error');
            }
        } catch (error) {
            console.error('Error starting battle:', error);
            this.showNotification('Failed to start battle. Please try again.', 'error');
        }
    }

    // Animate company change - winner stays; caller provides newOpponent
    async animateCompanyChange(losingSide, winningCompany, newOpponent) {
        const losingCard = document.getElementById(`company${losingSide}`);
        const winningSide = losingSide === 1 ? 2 : 1;
        
        // Animate out the losing company
        losingCard.classList.add('slide-out');
        
        setTimeout(() => {
            if (!newOpponent) {
                // Fallback if no opponent provided
                this.startNewBattle();
                return;
            }

            // Keep winner on same side; replace only the loser
            if (winningSide === 1) {
                this.currentBattle = { company1: winningCompany, company2: newOpponent };
            } else {
                this.currentBattle = { company1: newOpponent, company2: winningCompany };
            }
            
            // Update display with animation
            this.updateBattleDisplayWithAnimation(losingSide);
            
            // Remove animation classes
            setTimeout(() => {
                losingCard.classList.remove('slide-out');
            }, 300);
        }, 300);
    }

    // Update battle display
    updateBattleDisplay() {
        if (!this.currentBattle.company1 || !this.currentBattle.company2) {
            return;
        }

        this.updateCompanyDisplay(1, this.currentBattle.company1);
        this.updateCompanyDisplay(2, this.currentBattle.company2);
    }

    // Update battle display with animation
    updateBattleDisplayWithAnimation(changingSide) {
        if (!this.currentBattle.company1 || !this.currentBattle.company2) {
            return;
        }

        // Update the changing side with slide-in animation
        const changingCard = document.getElementById(`company${changingSide}`);
        changingCard.classList.add('slide-in');
        
        this.updateCompanyDisplay(changingSide, changingSide === 1 ? this.currentBattle.company1 : this.currentBattle.company2);
        
        // Remove animation class after animation completes
        setTimeout(() => {
            changingCard.classList.remove('slide-in');
        }, 300);
    }

    // Update individual company display
    updateCompanyDisplay(side, company) {
        const logo = document.getElementById(`logo${side}`);
        const name = document.getElementById(`name${side}`);
        const score = document.getElementById(`score${side}`);
        
        // Set name first
        name.textContent = company.name;
        
        // Hide score in battle view
        score.style.display = 'none';
        
        // Clear any existing fallback
        const existingFallback = logo.parentNode.querySelector('.logo-fallback-large');
        if (existingFallback) {
            existingFallback.remove();
        }
        
        // Reset logo display
        logo.style.display = 'block';
        
        // Set logo with error handling
        logo.onload = null;
        logo.onerror = () => {
            logo.style.display = 'none';
            const fallback = document.createElement('div');
            fallback.className = 'logo-fallback-large';
            fallback.innerHTML = `<span>${company.name.charAt(0)}</span>`;
            logo.parentNode.appendChild(fallback);
        };
        logo.src = company.logo;
    }

    // Handle voting with API
    async handleVote(e) {
        // Check cooldown
        const now = Date.now();
        if (now - this.lastVoteTime < this.voteCooldown) {
            return;
        }

        const companyIndex = parseInt(e.target.dataset.company);
        const votedCompany = companyIndex === 1 ? this.currentBattle.company1 : this.currentBattle.company2;
        const otherCompany = companyIndex === 1 ? this.currentBattle.company2 : this.currentBattle.company1;

        // Update last vote time
        this.lastVoteTime = now;

        // Show success animation
        const card = document.getElementById(`company${companyIndex}`);
        card.classList.add('vote-success');
        setTimeout(() => card.classList.remove('vote-success'), 600);

        // Submit vote to API
        try {
            const response = await fetch(`${this.apiBase}/vote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    winnerId: votedCompany.id,
                    loserId: otherCompany.id
                })
            });

            if (!response.ok) {
                // If vote fails, reload the battle to ensure consistency
                await this.startNewBattle();
                return;
            }

            const result = await response.json();

            // Update local company scores
            votedCompany.score = result.winnerScore;
            otherCompany.score = result.loserScore;
            // Update leaderboard
            this.updateLeaderboard();

            // Replace only the losing side with server-provided nextOpponent
            const losingSide = companyIndex === 1 ? 2 : 1;
            await this.animateCompanyChange(losingSide, votedCompany, result.nextOpponent || null);

        } catch (error) {
            // On error, reload the battle
            await this.startNewBattle();
        }
    }

    // Shuffle battle
    async shuffleBattle() {
        try {
            await this.startNewBattle();
            this.showNotification('New battle started!', 'info');
        } catch (error) {
            console.error('Error shuffling battle:', error);
            this.showNotification('Failed to shuffle battle. Please try again.', 'error');
        }
    }

    // Show notification
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            z-index: 10000;
            font-weight: 500;
            transform: translateX(100%);
            transition: transform 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TechArena();
});
