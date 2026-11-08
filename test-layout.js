// Playwright test: verify full-screen layout with mocked camera
async page => {
  // Inject fake camera BEFORE page scripts load
  await page.addInitScript(() => {
    const fakeCanvas = document.createElement('canvas');
    fakeCanvas.width = 1280;
    fakeCanvas.height = 720;
    const ctx = fakeCanvas.getContext('2d');
    let frame = 0;
    function drawFrame() {
      // Background gradient cycling through colors
      const grad = ctx.createLinearGradient(0, 0, 1280, 720);
      grad.addColorStop(0, `hsl(${frame % 360}, 55%, 18%)`);
      grad.addColorStop(1, `hsl(${(frame + 140) % 360}, 55%, 28%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1280, 720);

      // Fake "person" silhouette
      ctx.fillStyle = 'rgba(210, 160, 110, 0.85)';
      ctx.beginPath();
      ctx.ellipse(640, 300, 100, 130, 0, 0, Math.PI * 2);
      ctx.fill();

      // Labels
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FAKE CAMERA  1280 × 720', 640, 80);
      ctx.font = '20px monospace';
      ctx.fillStyle = '#ff6b00';
      ctx.fillText('Full-screen layout test', 640, 120);
      ctx.fillStyle = '#aaa';
      ctx.fillText(`frame ${frame}`, 640, 160);
      frame++;
      requestAnimationFrame(drawFrame);
    }
    drawFrame();

    const fakeStream = fakeCanvas.captureStream(30);
    // Override getUserMedia so MediaPipe Camera gets our canvas stream
    navigator.mediaDevices.getUserMedia = async () => fakeStream;
  });

  // Navigate to app
  await page.goto('http://localhost:8765/app/');
  // Wait for MediaPipe to initialize and render a few frames
  await page.waitForTimeout(6000);
}
