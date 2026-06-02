interface VoiceRoom {
    send(type: string, message?: unknown): void;
}

interface VoiceControllerOptions {
    getRoom: () => VoiceRoom | null;
    isOnlineGameActive: () => boolean;
    /** playerId(index) → Colyseus sessionId（機器人/空位回傳 null/undefined） */
    getPlayerSessionIds: () => (string | null | undefined)[];
}

interface VoiceStateMessage {
    type: string;
    existingParticipants?: string[];
    sessionId?: string;
}

interface VoiceSignalMessage {
    from: string;
    type: 'offer' | 'answer' | 'ice';
    payload: unknown;
}

export interface VoiceController {
    bindEvents(): void;
    /** render() 用：判斷某玩家座位是否正在說話 */
    isPlayerSpeaking(playerId: number): boolean;
    /** 主動離開語音頻道（通知 server），未在語音中則 no-op */
    leaveVoice(): void;
    /** 本地清除所有語音連線（不通知 server，用於換房/斷線），未在語音中則 no-op */
    resetVoiceConnections(): void;
    /** 處理 server 的 webrtc_voice_state 信令 */
    handleVoiceState(data: VoiceStateMessage): Promise<void>;
    /** 處理 server 的 webrtc_signal 信令 */
    handleSignal(data: VoiceSignalMessage): Promise<void>;
}

const WEBRTC_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export function createVoiceController(options: VoiceControllerOptions): VoiceController {
    let localAudioStream: MediaStream | null = null;
    const peerConnections = new Map<string, RTCPeerConnection>();
    let voiceActive = false;        // 是否在語音頻道
    let voiceMicMuted = false;      // 是否麥克風靜音
    /** sessionId → { analyser, data buffer } 用於說話偵測 */
    const voiceAnalysers = new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
    let voiceAudioContext: AudioContext | null = null;
    /** sessionId → 是否正在說話 */
    const voiceSpeakingStates = new Map<string, boolean>();

    function isPlayerSpeaking(playerId: number): boolean {
        const sessionId = options.getPlayerSessionIds()[playerId];
        return sessionId ? voiceSpeakingStates.get(sessionId) === true : false;
    }

    /** 更新麥克風按鈕的視覺狀態 */
    function updateMicButtonState() {
        const btn = document.getElementById('mic-btn');
        if (!btn) return;
        btn.classList.toggle('voice-active', voiceActive && !voiceMicMuted);
        btn.classList.toggle('voice-muted',  voiceActive && voiceMicMuted);
        // 麥克風靜音時，重用喇叭靜音的 SVG 斜線效果
        btn.classList.toggle('muted', voiceActive && voiceMicMuted);
    }

    /** 根據 voiceSpeakingStates 更新對手區域的說話指示燈 */
    function updateSpeakingIndicators() {
        if (!options.isOnlineGameActive()) return;
        const sessionIds = options.getPlayerSessionIds();
        for (const [sessionId, isSpeaking] of voiceSpeakingStates) {
            const playerIdx = sessionIds.indexOf(sessionId);
            if (playerIdx < 0) continue;
            const el = document.querySelector<HTMLElement>(`.opponent-area[data-player-id="${playerIdx}"]`);
            el?.classList.toggle('voice-speaking', isSpeaking);
        }
    }

    /** 為遠端 peer 建立音訊播放並開始說話偵測 */
    function setupRemoteAudio(peerId: string, stream: MediaStream) {
        // 建立或重用 <audio> 元素
        let audioEl = document.getElementById(`voice-audio-${peerId}`) as HTMLAudioElement | null;
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `voice-audio-${peerId}`;
            audioEl.autoplay = true;
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = stream;

        // 說話偵測：Web Audio API
        if (!voiceAudioContext) voiceAudioContext = new AudioContext();
        const source = voiceAudioContext.createMediaStreamSource(stream);
        const analyser = voiceAudioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        voiceAnalysers.set(peerId, { analyser, data });
    }

    /** 建立與指定 peer 的 RTCPeerConnection */
    function createPeerConnection(peerId: string): RTCPeerConnection {
        // 關閉舊連線（若存在）
        peerConnections.get(peerId)?.close();

        const pc = new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS });
        peerConnections.set(peerId, pc);

        // 加入本地音訊軌道
        localAudioStream?.getTracks().forEach(track => {
            pc.addTrack(track, localAudioStream!);
        });

        // ICE candidate → 透過 Colyseus 轉送
        pc.onicecandidate = e => {
            if (e.candidate) {
                options.getRoom()?.send('webrtc_signal', { to: peerId, type: 'ice', payload: e.candidate.toJSON() });
            }
        };

        // 收到遠端音訊軌道
        pc.ontrack = e => {
            const stream = e.streams[0];
            if (stream) setupRemoteAudio(peerId, stream);
        };

        // 連線失敗時清除
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                closePeerConnection(peerId);
            }
        };

        return pc;
    }

    /** 關閉與指定 peer 的連線並清理資源 */
    function closePeerConnection(peerId: string) {
        peerConnections.get(peerId)?.close();
        peerConnections.delete(peerId);
        voiceAnalysers.delete(peerId);
        voiceSpeakingStates.delete(peerId);
        document.getElementById(`voice-audio-${peerId}`)?.remove();
        updateSpeakingIndicators();
    }

    /** 本地拆除所有語音資源（不通知 server） */
    function teardownLocalVoice() {
        for (const peerId of [...peerConnections.keys()]) closePeerConnection(peerId);
        localAudioStream?.getTracks().forEach(t => t.stop());
        localAudioStream = null;
        voiceActive = false;
        voiceMicMuted = false;
        voiceAnalysers.clear();
        voiceSpeakingStates.clear();
        updateMicButtonState();
    }

    /** 加入語音頻道 */
    async function joinVoice() {
        try {
            localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            voiceActive = true;
            voiceMicMuted = false;
            options.getRoom()?.send('webrtc_join_voice');
            updateMicButtonState();
        } catch {
            alert('無法取得麥克風權限，請在瀏覽器設定中允許麥克風存取。');
        }
    }

    function leaveVoice() {
        if (!voiceActive) return;
        options.getRoom()?.send('webrtc_leave_voice');
        teardownLocalVoice();
        updateSpeakingIndicators();
    }

    function resetVoiceConnections() {
        if (!voiceActive) return;
        teardownLocalVoice();
    }

    /** 切換麥克風靜音（或第一次點擊時加入語音） */
    function handleMicClick() {
        if (!voiceActive) {
            void joinVoice();
            return;
        }
        voiceMicMuted = !voiceMicMuted;
        localAudioStream?.getTracks().forEach(t => { t.enabled = !voiceMicMuted; });
        updateMicButtonState();
    }

    async function handleVoiceState(data: VoiceStateMessage) {
        if (data.type === 'you_joined') {
            // 我加入了：對每個已在語音的 peer 發起 offer
            for (const peerId of (data.existingParticipants ?? [])) {
                const pc = createPeerConnection(peerId);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                options.getRoom()?.send('webrtc_signal', { to: peerId, type: 'offer', payload: { type: offer.type, sdp: offer.sdp } });
            }
        } else if (data.type === 'peer_left' && data.sessionId) {
            closePeerConnection(data.sessionId);
        }
        // 'peer_joined'：新加入者會主動對我發 offer，不需要我主動建立
    }

    async function handleSignal(data: VoiceSignalMessage) {
        // 未加入語音或 stream 尚未就緒時忽略（避免 race condition）
        if (!voiceActive || !localAudioStream) return;
        try {
            if (data.type === 'offer') {
                const pc = createPeerConnection(data.from);
                await pc.setRemoteDescription(new RTCSessionDescription(data.payload as RTCSessionDescriptionInit));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                options.getRoom()?.send('webrtc_signal', { to: data.from, type: 'answer', payload: { type: answer.type, sdp: answer.sdp } });
            } else if (data.type === 'answer') {
                const pc = peerConnections.get(data.from);
                if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.payload as RTCSessionDescriptionInit));
            } else if (data.type === 'ice') {
                const pc = peerConnections.get(data.from);
                if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.payload as RTCIceCandidateInit));
            }
        } catch (err) {
            console.warn('[WebRTC] Signal handling error:', err);
        }
    }

    function bindEvents() {
        const micBtn = document.getElementById('mic-btn');
        if (micBtn) micBtn.onclick = handleMicClick;

        // 說話偵測定時器：每 100ms 採樣一次音量
        setInterval(() => {
            if (!voiceActive || voiceAnalysers.size === 0) return;
            let changed = false;
            for (const [peerId, { analyser, data }] of voiceAnalysers) {
                analyser.getByteFrequencyData(data);
                const avg = data.reduce((s, v) => s + v, 0) / data.length;
                const isSpeaking = avg > 8;
                if (voiceSpeakingStates.get(peerId) !== isSpeaking) {
                    voiceSpeakingStates.set(peerId, isSpeaking);
                    changed = true;
                }
            }
            if (changed) updateSpeakingIndicators();
        }, 100);
    }

    return {
        bindEvents,
        isPlayerSpeaking,
        leaveVoice,
        resetVoiceConnections,
        handleVoiceState,
        handleSignal,
    };
}
