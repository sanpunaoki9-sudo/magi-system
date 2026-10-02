// マイクの音を一定の長さごとにメインスレッドへ送る（AudioWorklet）
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(480); // 16kHz で 30ms
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('oz-capture', CaptureProcessor);
