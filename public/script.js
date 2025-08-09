// TechArena - Software Company Rankings (Vercel + Lambda Function URL)
class TechArena {
    constructor() {
      this.companies = [];
      this.currentBattle = { company1: null, company2: null };
      this.apiBase = (window.__API_BASE__ || 'https://YOUR-FUNCTION-URL/api').replace(/\/+$/, '');
      this.lastVoteTime = 0;
      this.voteCooldown = 1000;
  
      // device id for rate limiting
      this.DEVICE_ID = this.getDeviceId();
      this.commonHeaders = { 'x-device-id': this.DEVICE_ID };
  
      this.init();
    }
  
    // simple uuid v4
    getDeviceId() {
      const KEY = 'faangar-device-id';
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
          (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
        localStorage.setItem(KEY, id);
      }
      return id;
    }
  
    init() {
      this.loadCompanies().then(() => this.updateLeaderboard());
      this.setupEventListeners();
      this.startNewBattle();
    }
  
    async loadCompanies() {
      try {
        const response = await fetch(`${this.apiBase}/companies`, { mode: 'cors', headers: this.commonHeaders });
        if (!response.ok) throw new Error('Failed to load companies');
        this.companies = await response.json();
      } catch (error) {
        console.error('Error loading companies:', error);
        this.showNotification('Failed to load companies. Please refresh the page.', 'error');
      }
    }
  
    setupEventListeners() {
      document.getElementById('leaderboardBtn').addEventListener('click', () => this.showView('leaderboard'));
      document.getElementById('battleBtn').addEventListener('click', () => this.showView('battle'));
      document.querySelectorAll('.vote-btn').forEach(btn => btn.addEventListener('click', (e) => this.handleVote(e)));
      document.getElementById('shuffleBtn').addEventListener('click', () => this.shuffleBattle());
    }
  
    showView(viewName) {
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      (viewName === 'leaderboard' ? leaderboardBtn : battleBtn).classList.add('active');
  
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      if (viewName === 'leaderboard') {
        leaderboardView.classList.add('active');
        this.loadCompanies().then(() => this.updateLeaderboard());
      } else {
        battleView.classList.add('active');
        if (!this.currentBattle.company1 || !this.currentBattle.company2) this.startNewBattle();
      }
    }
  
    updateLeaderboard() {
      const leaderboardList = document.getElementById('leaderboardList');
      const sorted = [...this.companies].sort((a, b) => b.score - a.score);
  
      leaderboardList.innerHTML = sorted.map((c, i) => `
        <div class="leaderboard-item">
          <div class="rank">#${i + 1}</div>
          <div class="logo-container">
            <img src="${c.logo}" alt="${c.name}" class="logo"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="logo-fallback" style="display: none;"><span>${c.name.charAt(0)}</span></div>
          </div>
          <div class="info">
            <div class="name">${c.name}</div>
            <div class="score">${c.score} points</div>
          </div>
        </div>
      `).join('');
    }
  
    async startNewBattle() {
      try {
        const response = await fetch(`${this.apiBase}/battle`, { mode: 'cors', headers: this.commonHeaders });
        if (!response.ok) throw new Error('Failed to get battle companies');
        const pair = await response.json();
  
        if (pair.length >= 2) {
          this.currentBattle = { company1: pair[0], company2: pair[1] };
          this.updateBattleDisplay();
        } else {
          this.showNotification('Not enough companies for battle!', 'error');
        }
      } catch (error) {
        console.error('Error starting battle:', error);
        this.showNotification('Failed to start battle. Please try again.', 'error');
      }
    }

    // Animate company change - keeps winning company on same side
    async animateCompanyChange(losingSide, winner) {
        const losingCard = document.getElementById(`company${losingSide}`);
        // Animate out the losing company
        losingCard.classList.add('slide-out');
        setTimeout(async () => {
            try {
                // Get a new battle from API
                const response = await fetch(`${this.apiBase}/battle`);
                if (!response.ok) {
                    throw new Error('Failed to get new battle');
                }
                const newCompanies = await response.json();
                // Find a new opponent that is not the winner
                const newOpponent = newCompanies.find(c => c.id !== winner.id);
                if (!newOpponent) {
                    throw new Error('No suitable opponent found');
                }
                // Update battle state - keep winner on the same side
                if (losingSide === 1) {
                    this.currentBattle = { company1: newOpponent, company2: winner };
                } else {
                    this.currentBattle = { company1: winner, company2: newOpponent };
                }
                // Update display with animation
                this.updateBattleDisplayWithAnimation(losingSide);
                // Remove animation classes
                setTimeout(() => {
                    losingCard.classList.remove('slide-out');
                }, 300);
            } catch (error) {
                console.error('Error updating battle:', error);
                this.showNotification('Failed to update battle. Please try again.', 'error');
            }
        }, 300);
    }

    // Update battle display
    updateBattleDisplay() {
      if (!this.currentBattle.company1 || !this.currentBattle.company2) return;
      this.updateCompanyDisplay(1, this.currentBattle.company1);
      this.updateCompanyDisplay(2, this.currentBattle.company2);
    }
  
    updateBattleDisplayWithAnimation(changingSide) {
      if (!this.currentBattle.company1 || !this.currentBattle.company2) return;
      const changingCard = document.getElementById(`company${changingSide}`);
      changingCard.classList.add('slide-in');
      this.updateCompanyDisplay(
        changingSide,
        changingSide === 1 ? this.currentBattle.company1 : this.currentBattle.company2
      );
      setTimeout(() => changingCard.classList.remove('slide-in'), 300);
    }
  
    updateCompanyDisplay(side, company) {
      const logo = document.getElementById(`logo${side}`);
      const name = document.getElementById(`name${side}`);
      const score = document.getElementById(`score${side}`);
  
      name.textContent = company.name;
      score.style.display = 'none';
  
      const existingFallback = logo.parentNode.querySelector('.logo-fallback-large');
      if (existingFallback) existingFallback.remove();
  
      logo.style.display = 'block';
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
  
    async handleVote(e) {
        // Check cooldown
        const now = Date.now();
        if (now - this.lastVoteTime < this.voteCooldown) {
            // No error notification, just ignore click
            return;
        }

        const companyIndex = parseInt(e.target.dataset.company); // 1 or 2
        const winner = companyIndex === 1 ? this.currentBattle.company1 : this.currentBattle.company2;
        const loserSide = companyIndex === 1 ? 2 : 1;

        // Update last vote time
        this.lastVoteTime = now;

        // Show success animation
        const card = document.getElementById(`company${companyIndex}`);
        card.classList.add('vote-success');
        setTimeout(() => card.classList.remove('vote-success'), 600);

        // Optimistically animate out the losing company and replace with new opponent
        this.animateCompanyChange(loserSide, winner);

        // Submit vote to API in background
        (async () => {
            try {
                const response = await fetch(`${this.apiBase}/vote`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        winnerId: winner.id,
                        loserId: loserSide === 1 ? this.currentBattle.company1.id : this.currentBattle.company2.id
                    })
                });

                if (!response.ok) {
                    // If vote fails, reload the battle to ensure consistency
                    await this.startNewBattle();
                    return;
                }

                const result = await response.json();
                // Update local company scores
                winner.score = result.winnerScore;
                if (loserSide === 1) {
                    this.currentBattle.company1.score = result.loserScore;
                } else {
                    this.currentBattle.company2.score = result.loserScore;
                }
                // Update leaderboard
                this.updateLeaderboard();
            } catch (error) {
                // On error, reload the battle
                await this.startNewBattle();
            }
        })();
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
  
    showNotification(message, type = 'info') {
      const notification = document.createElement('div');
      notification.className = `notification notification-${type}`;
      notification.textContent = message;
      notification.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white; padding: 15px 20px; border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 10000;
        font-weight: 500; transform: translateX(100%); transition: transform .3s ease;
      `;
      document.body.appendChild(notification);
      setTimeout(() => { notification.style.transform = 'translateX(0)'; }, 100);
      setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => { notification.remove(); }, 300);
      }, 3000);
    }
  }
  
  document.addEventListener('DOMContentLoaded', () => new TechArena());
  