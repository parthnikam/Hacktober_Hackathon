document.querySelector("#allow").addEventListener("click", async () => {
  const status = document.querySelector("#mic-status");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    const permission = await navigator.permissions.query({ name: "microphone" });
    if (permission.state !== "granted") {
      status.textContent = "That only lasts for this tab. Click Allow microphone again and choose Allow.";
      return;
    }
    chrome.runtime.sendMessage({ type: "mic-permission", granted: true });
  } catch {
    status.textContent = "The microphone is blocked. Use the tune icon in the address bar, set Microphone to Allow, then click the button again.";
  }
});
