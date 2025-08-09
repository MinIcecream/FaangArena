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
      const now = Date.now();
      if (now - this.lastVoteTime < this.voteCooldown) return;
  
      const companyIndex = parseInt(e.target.dataset.company, 10);
      const votedCompany = companyIndex === 1 ? this.currentBattle.company1 : this.currentBattle.company2;
      const otherCompany = companyIndex === 1 ? this.currentBattle.company2 : this.currentBattle.company1;
  
      this.lastVoteTime = now;
  
      const card = document.getElementById(`company${companyIndex}`);
      card.classList.add('vote-success');
      setTimeout(() => card.classList.remove('vote-success'), 600);
  
      try {
        const response = await fetch(`${this.apiBase}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.commonHeaders },
          mode: 'cors',
          body: JSON.stringify({ winnerId: votedCompany.id, loserId: otherCompany.id })
        });
  
        if (!response.ok) {
          await this.startNewBattle(); // fallback on error
          return;
        }
  
        const result = await response.json();
        // Update local scores
        votedCompany.score = result.winnerScore;
        otherCompany.score = result.loserScore;
        this.updateLeaderboard();
  
        const losingSide = companyIndex === 1 ? 2 : 1;
        if (result.nextOpponent && result.nextOpponent.id) {
          this.swapInNewOpponent(losingSide, votedCompany, result.nextOpponent);
        } else {
          await this.startNewBattle(); // fallback
        }
      } catch (error) {
        console.error('Vote error:', error);
        await this.startNewBattle();
      }
    }
  
    swapInNewOpponent(losingSide, winningCompany, nextOpponent) {
      const losingCard = document.getElementById(`company${losingSide}`);
      losingCard.classList.add('slide-out');
  
      setTimeout(() => {
        if (losingSide === 1) {
          this.currentBattle = { company1: nextOpponent, company2: winningCompany };
        } else {
          this.currentBattle = { company1: winningCompany, company2: nextOpponent };
        }
  
        this.updateBattleDisplayWithAnimation(losingSide);
        setTimeout(() => losingCard.classList.remove('slide-out'), 300);
      }, 300);
    }
  
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
  