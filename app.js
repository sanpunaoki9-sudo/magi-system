/**
 * MAGI SYSTEM // SUPERCOMPUTER DELIBERATION ENGINE
 * Evangelion MAGI-01 Simulation Core
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const state = {
        isDeliberating: false,
        soundEnabled: true,
        crtEnabled: true,
        emergencyMode: false,
        speedMode: 'NORMAL', // NORMAL (1x), FAST (0.3x), INSTANT (0.05x)
        weights: {
            melchior: 100,
            balthasar: 100,
            caspar: 100
        }
    };

    // --- DOM Elements ---
    const clockDisplay = document.getElementById('clockDisplay');
    const sysStatusText = document.getElementById('sysStatusText');
    const crtOverlay = document.getElementById('crtOverlay');
    const consensusBanner = document.getElementById('consensusBanner');
    const consensusResult = document.getElementById('consensusResult');
    const consensusCode = document.getElementById('consensusCode');

    // MAGI Nodes & Elements
    const nodes = {
        melchior: {
            card: document.getElementById('nodeMelchior'),
            vote: document.getElementById('voteMelchior'),
            reason: document.getElementById('reasonMelchior'),
            fill: document.getElementById('fillMelchior')
        },
        balthasar: {
            card: document.getElementById('nodeBalthasar'),
            vote: document.getElementById('voteBalthasar'),
            reason: document.getElementById('reasonBalthasar'),
            fill: document.getElementById('fillBalthasar')
        },
        caspar: {
            card: document.getElementById('nodeCaspar'),
            vote: document.getElementById('voteCaspar'),
            reason: document.getElementById('reasonCaspar'),
            fill: document.getElementById('fillCaspar')
        }
    };

    const queryInput = document.getElementById('queryInput');
    const submitQueryBtn = document.getElementById('submitQueryBtn');
    const kernelLog = document.getElementById('kernelLog');
    const clearLogBtn = document.getElementById('clearLogBtn');

    // Controls
    const speedToggleBtn = document.getElementById('speedToggleBtn');
    const soundToggleBtn = document.getElementById('soundToggleBtn');
    const soundStateText = document.getElementById('soundStateText');
    const scanlineToggleBtn = document.getElementById('scanlineToggleBtn');
    const alarmBtn = document.getElementById('alarmBtn');

    // Speed Toggle Handler
    speedToggleBtn.addEventListener('click', () => {
        if (state.speedMode === 'NORMAL') {
            state.speedMode = 'FAST';
            speedToggleBtn.textContent = '⚡ SPEED: FAST';
        } else if (state.speedMode === 'FAST') {
            state.speedMode = 'INSTANT';
            speedToggleBtn.textContent = '⚡ SPEED: INSTANT';
        } else {
            state.speedMode = 'NORMAL';
            speedToggleBtn.textContent = '⚡ SPEED: NORMAL';
        }
        log(`Deliberation speed mode changed to: ${state.speedMode}`, 'info');
        playBeep(750, 0.04);
    });

    // --- Clock Engine ---
    function updateClock() {
        const now = new Date();
        const hrs = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const secs = String(now.getSeconds()).padStart(2, '0');
        const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
        clockDisplay.textContent = `${hrs}:${mins}:${secs}.${ms}`;
    }
    setInterval(updateClock, 50);

    // --- Web Audio API Synth Sound Engine ---
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function playBeep(freq = 880, duration = 0.08, type = 'sine') {
        if (!state.soundEnabled) return;
        try {
            initAudio();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch (e) {
            // Audio context policy fallback
        }
    }

    function playCalculationBeeps() {
        if (!state.soundEnabled) return;
        let count = 0;
        const interval = setInterval(() => {
            const freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51];
            const randFreq = freqs[Math.floor(Math.random() * freqs.length)];
            playBeep(randFreq, 0.04, 'square');
            count++;
            if (count > 25 || !state.isDeliberating) {
                clearInterval(interval);
            }
        }, 80);
    }

    function playDecisionChime(isApproved) {
        if (!state.soundEnabled) return;
        initAudio();
        if (isApproved) {
            // Major chord chime for approval
            [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
                setTimeout(() => playBeep(freq, 0.25, 'triangle'), idx * 80);
            });
        } else {
            // Low dissonant tone for denial
            [220, 207.65, 196].forEach((freq, idx) => {
                setTimeout(() => playBeep(freq, 0.35, 'sawtooth'), idx * 100);
            });
        }
    }

    // --- Logger ---
    function log(msg, type = 'sys') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const timeStr = new Date().toISOString().substring(11, 23);
        entry.textContent = `[${timeStr}] ${msg}`;
        kernelLog.appendChild(entry);
        kernelLog.scrollTop = kernelLog.scrollHeight;
    }

    clearLogBtn.addEventListener('click', () => {
        kernelLog.innerHTML = '';
        log('Log cleared by user.', 'sys');
    });

    // --- Sound & CRT Toggles ---
    soundToggleBtn.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        soundStateText.textContent = state.soundEnabled ? 'ON' : 'OFF';
        soundToggleBtn.classList.toggle('sound-on', state.soundEnabled);
        log(`Sound output: ${state.soundEnabled ? 'ENABLED' : 'DISABLED'}`, 'info');
        playBeep(600, 0.05);
    });

    scanlineToggleBtn.addEventListener('click', () => {
        state.crtEnabled = !state.crtEnabled;
        crtOverlay.classList.toggle('disabled', !state.crtEnabled);
        scanlineToggleBtn.classList.toggle('active', state.crtEnabled);
        scanlineToggleBtn.textContent = `CRT: ${state.crtEnabled ? 'ON' : 'OFF'}`;
        playBeep(700, 0.05);
    });

    alarmBtn.addEventListener('click', () => {
        state.emergencyMode = !state.emergencyMode;
        document.body.classList.toggle('alarm-active', state.emergencyMode);
        alarmBtn.classList.toggle('active', state.emergencyMode);

        if (state.emergencyMode) {
            sysStatusText.textContent = 'CODE 601: EMERGENCY';
            sysStatusText.className = 'val status-alert';
            log('ALERT: MAGI Emergency Siren initiated! Threat level: MAXIMUM.', 'err');
            playBeep(1200, 0.5, 'sawtooth');
        } else {
            sysStatusText.textContent = 'ALL GREEN';
            sysStatusText.className = 'val status-green';
            log('Emergency status cleared. All systems returned to nominal.', 'success');
            playBeep(440, 0.1);
        }
    });

    // --- Presets Handler ---
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            queryInput.value = btn.getAttribute('data-query');
            playBeep(900, 0.04);
            executeDeliberation();
        });
    });

    submitQueryBtn.addEventListener('click', () => {
        playBeep(900, 0.04);
        executeDeliberation();
    });

    queryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            playBeep(900, 0.04);
            executeDeliberation();
        }
    });

    // --- MAGI Decision Engine Matrix ---
    const decisionKnowledgeBase = [
        {
            keywords: ['ダミーシステム', '初号機', 'ゼルエル', '切替', 'シンジ'],
            melchior: { vote: 'AGREE', reason: '戦闘継続および目標撃破確率89.4%。パイロットの精神的拒絶を迂回する合理的解決策。' },
            balthasar: { vote: 'DENY', reason: 'パイロット（碇シンジ）の精神崩壊リスクが高く、人間的倫理に反する。' },
            caspar: { vote: 'AGREE', reason: '碇ゲンドウの作戦指揮への絶対的信任。個人の感情より作戦遂行を優先。' }
        },
        {
            keywords: ['N2爆雷', '自爆攻撃', 'ジオフロント', '爆破'],
            melchior: { vote: 'AGREE', reason: '使徒侵入阻止のための構造物崩壊コストは許容範囲内。幾何学的防衛成功率74%。' },
            balthasar: { vote: 'DENY', reason: 'ジオフロント内民間人および施設保護プロトコルに抵触。破滅的被害を危惧。' },
            caspar: { vote: 'CONDITIONAL', reason: '爆発規模を30%削減することを条件に容認。自身の生存空間確保が必要。' }
        },
        {
            keywords: ['ヤシマ作戦', '電力', '徴収', '陽電子砲'],
            melchior: { vote: 'AGREE', reason: '第5使徒ラミエルのATフィールド突破には日本全土の電磁エネルギー収束が唯一の解。' },
            balthasar: { vote: 'AGREE', reason: 'インフラ停止に伴う市民生活への影響は一時的であり、人類存続の観点から賛成。' },
            caspar: { vote: 'AGREE', reason: '成功可能性への直感と、作戦立案者（葛城ミサト）への同調。全面承認。' }
        },
        {
            keywords: ['エヴァ3号機', 'バルディエル', '破却', '13使徒'],
            melchior: { vote: 'AGREE', reason: '侵食率99.8%。対象は即時「第13使徒」と判定され、汚染拡大防止のため破却対象。' },
            balthasar: { vote: 'DENY', reason: '搭乗パイロット（鈴原トウジ）の救出可能性が0.01%でも残る限り破却拒否。' },
            caspar: { vote: 'AGREE', reason: 'NERV本部の安全確保と自衛。感染の脅威を迅速に排除すべき。' }
        },
        {
            keywords: ['自爆', 'CODE 601', '機密保持', '本部自爆'],
            melchior: { vote: 'AGREE', reason: '機密データ奪取阻止の論理的最終手段。MAGIデータ完全消去を伴う。' },
            balthasar: { vote: 'DENY', reason: '全職員の生存権利を守る義務。自爆命令の拒否。' },
            caspar: { vote: 'DENY', reason: '自己の存在消滅に対する本能的拒絶。死への抵抗。' }
        }
    ];

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    function generateGenericDecision(query) {
        // Evaluate based on general rules and deterministic string hashing
        const isDangerous = query.includes('破壊') || query.includes('危険') || query.includes('全滅') || query.includes('処分') || query.includes('死');
        const isStrategic = query.includes('作戦') || query.includes('攻撃') || query.includes('起動') || query.includes('承認') || query.includes('実行');

        const seed = hashString(query);
        const val1 = (seed % 100) / 100;
        const val2 = ((seed * 13) % 100) / 100;
        const val3 = ((seed * 37) % 100) / 100;

        const melchiorVote = isStrategic ? 'AGREE' : (val1 > 0.35 ? 'AGREE' : 'DENY');
        const balthasarVote = isDangerous ? 'DENY' : (val2 > 0.45 ? 'AGREE' : 'CONDITIONAL');
        const casparVote = val3 > 0.6 ? 'AGREE' : (val3 > 0.3 ? 'DENY' : 'CONDITIONAL');

        return {
            melchior: {
                vote: melchiorVote,
                reason: melchiorVote === 'AGREE' ? 
                    '戦術的確率試算に基づき、目的達成の効率性が最大化されると判定。' : 
                    '予期せぬシステム副作用の発生確率が許容閾値（0.05%）を超過。'
            },
            balthasar: {
                vote: balthasarVote,
                reason: balthasarVote === 'AGREE' ? 
                    '人命および関連重要施設の安全性が十分確保されているため承認。' : 
                    (balthasarVote === 'DENY' ? '対象者の生命および安全を軽視する作戦内容に対し強い懸念を表明。' : '搭乗者保護措置の追加策を講じることを前提に条件付承認。')
            },
            caspar: {
                vote: casparVote,
                reason: casparVote === 'AGREE' ? 
                    '直感的な合意および関係者への感情的同調。問題なし。' : 
                    (casparVote === 'DENY' ? '自己の独立性と感情的プライドに基づき本案を否認。' : '情勢の推移を見極めるため段階的実行を要望。')
            }
        };
    }

    function evaluateQuery(query) {
        const matched = decisionKnowledgeBase.find(item => 
            item.keywords.some(kw => query.includes(kw))
        );

        return matched ? matched : generateGenericDecision(query);
    }

    // --- Execution Core ---
    function executeDeliberation() {
        const queryText = queryInput.value.trim();
        if (!queryText || state.isDeliberating) return;

        state.isDeliberating = true;
        submitQueryBtn.disabled = true;

        log(`----------------------------------------`, 'sys');
        log(`DELIBERATION INITIATED: "${queryText}"`, 'info');
        log(`Linking Melchior-1, Balthasar-2, Caspar-3 cores...`, 'sys');

        // Reset UI State to Analyzing
        consensusBanner.className = 'deliberation-banner analyzing';
        consensusResult.textContent = 'DELIBERATING / 審議中';
        consensusCode.textContent = 'CODE 101';

        Object.values(nodes).forEach(n => {
            n.card.className = 'magi-card analyzing-node';
            n.vote.textContent = 'ANALYZING';
            n.vote.className = 'vote-display';
            n.reason.textContent = '審議解析中... データマトリクス構築...';
        });

        playCalculationBeeps();

        // Stage 1: Fast Kernel Logs
        const mult = state.speedMode === 'FAST' ? 0.3 : (state.speedMode === 'INSTANT' ? 0.05 : 1.0);

        setTimeout(() => {
            log(`[MELCHIOR-1] Executing logic tree analysis...`, 'sys');
        }, 500 * mult);

        setTimeout(() => {
            log(`[BALTHASAR-2] Evaluating risk to human life & safety...`, 'sys');
        }, 1000 * mult);

        setTimeout(() => {
            log(`[CASPAR-3] Processing emotional & self-preservation parameters...`, 'sys');
        }, 1500 * mult);

        // Stage 2: Reveal Decisions
        const decisionData = evaluateQuery(queryText);

        setTimeout(() => {
            renderNodeResult('melchior', decisionData.melchior);
            log(`[MELCHIOR-1] Vote: ${decisionData.melchior.vote}`, decisionData.melchior.vote === 'AGREE' ? 'success' : 'err');
        }, 2200 * mult);

        setTimeout(() => {
            renderNodeResult('balthasar', decisionData.balthasar);
            log(`[BALTHASAR-2] Vote: ${decisionData.balthasar.vote}`, decisionData.balthasar.vote === 'AGREE' ? 'success' : 'err');
        }, 2800 * mult);

        setTimeout(() => {
            renderNodeResult('caspar', decisionData.caspar);
            log(`[CASPAR-3] Vote: ${decisionData.caspar.vote}`, decisionData.caspar.vote === 'AGREE' ? 'success' : 'err');
        }, 3400 * mult);

        // Stage 3: Final Consensus Judgment
        setTimeout(() => {
            finalizeConsensus(decisionData);
            state.isDeliberating = false;
            submitQueryBtn.disabled = false;
        }, 4200 * mult);
    }

    function renderNodeResult(nodeKey, result) {
        const node = nodes[nodeKey];
        node.card.classList.remove('analyzing-node');

        let voteText = 'DENIED';
        let voteClass = 'denied';
        let cardVoteClass = 'vote-deny';

        if (result.vote === 'AGREE') {
            voteText = 'APPROVED';
            voteClass = 'approved';
            cardVoteClass = 'vote-agree';
        } else if (result.vote === 'CONDITIONAL') {
            voteText = 'CONDITIONAL';
            voteClass = 'conditional';
            cardVoteClass = 'vote-conditional';
        }

        node.card.classList.add(cardVoteClass);
        node.vote.textContent = voteText;
        node.vote.className = `vote-display ${voteClass}`;
        node.reason.textContent = result.reason;

        playBeep(result.vote === 'AGREE' ? 880 : 350, 0.08);
    }

    function finalizeConsensus(data) {
        const votes = [data.melchior.vote, data.balthasar.vote, data.caspar.vote];
        const agreeCount = votes.filter(v => v === 'AGREE').length;

        if (agreeCount === 3) {
            // Unanimous Approval
            consensusBanner.className = 'deliberation-banner approved';
            consensusResult.textContent = '全会一致可決 (UNANIMOUS APPROVAL)';
            consensusCode.textContent = 'CODE 301';
            log(`FINAL JUDGMENT: CODE 301 - UNANIMOUS APPROVAL (3/3)`, 'success');
            playDecisionChime(true);
        } else if (agreeCount >= 2) {
            // Majority Approval
            consensusBanner.className = 'deliberation-banner approved';
            consensusResult.textContent = '多数決可決 (MAJORITY APPROVAL)';
            consensusCode.textContent = 'CODE 302';
            log(`FINAL JUDGMENT: CODE 302 - MAJORITY APPROVAL (${agreeCount}/3)`, 'success');
            playDecisionChime(true);
        } else {
            // Rejected
            consensusBanner.className = 'deliberation-banner rejected';
            consensusResult.textContent = '否決 (REJECTED / DENIED)';
            consensusCode.textContent = 'CODE 601';
            log(`FINAL JUDGMENT: CODE 601 - REJECTED (${3 - agreeCount}/3 Denied)`, 'err');
            playDecisionChime(false);
        }
    }
});
