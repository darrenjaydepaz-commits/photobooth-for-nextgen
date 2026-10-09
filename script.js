"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);

  /* ========================================
     PAGE NAVIGATION
  ======================================== */

  const pages = document.querySelectorAll(".page");

  function showPage(pageId) {
    const target = $(pageId);
    if (!target) return;

    pages.forEach(page => page.classList.remove("active"));
    target.classList.add("active");

    window.scrollTo({ top: 0, behavior: "auto" });

    if (pageId === "editorPage") {
      initializeEditor();
      renderEditor();
    }
  }

  $("enterBooth").addEventListener("click", () => {
    showPage("boothPage");
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.page);
    });
  });


  /* ========================================
     PHOTOBOOTH ELEMENTS
  ======================================== */

  const camera = $("camera");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");

  const startButton = $("startCamera");
  const captureButton = $("capture");
  const retakeButton = $("retake");
  const printButton = $("print");
  const downloadButton = $("download");
  const cancelButton = $("cancelSession");
  const openEditorButton = $("openEditor");

  const placeholder = $("cameraPlaceholder");
  const previewPlaceholder = $("previewPlaceholder");
  const countdown = $("countdown");
  const flash = $("flash");
  const status = $("status");

  const preview = $("preview");
  const printImage = $("printImage");
  const captionInput = $("captionInput");

  const gridOptions = document.querySelectorAll(".grid-option");
  const timerOptions = document.querySelectorAll(".timer-option");

  const gridStatus = $("gridStatus");
  const progressPercent = $("progressPercent");
  const progressBar = $("progressBar");

  let stream = null;
  let photoURL = null;
  let photos = [];

  let selectedCount = 4;
  let selectedSeconds = 3;

  let cameraReady = false;
  let busy = false;
  let sessionActive = false;
  let cancelRequested = false;
  let sessionToken = 0;
  let disposed = false;


  /* ========================================
     PHOTO EDITOR STATE
  ======================================== */

  const editorCanvas = $("editorCanvas");
  const editorCtx = editorCanvas.getContext("2d");

  const editorEmpty = $("editorEmpty");
  const editorStatus = $("editorStatus");

  const brightnessInput = $("brightness");
  const contrastInput = $("contrast");
  const saturationInput = $("saturation");
  const stickerSizeInput = $("stickerSize");
  const editorCaptionInput = $("editorCaption");
  const overlayTextInput = $("overlayTextInput");
  const overlayTextSelect = $("overlayTextSelect");
  const overlayFontInput = $("overlayFont");
  const overlayFontStyleInput = $("overlayFontStyle");
  const overlayTextColorInput = $("overlayTextColor");
  const overlayTextSizeInput = $("overlayTextSize");
  const overlayTextSizeValue = $("overlayTextSizeValue");

  const filterButtons = document.querySelectorAll(".filter-option");
  const stickerButtons = document.querySelectorAll(".sticker-option");

  const editorState = {
    image: null,
    imageURL: null,
    filter: "normal",
    brightness: 100,
    contrast: 100,
    saturation: 100,
    stickers: [],
    texts: [],
    selectedTextId: null,
    nextTextId: 1,
    selectedEmoji: null,
    stickerSize: 64,
    caption: "a moment to remember ♡",
    date: "",
    imageWidth: 900,
    imageHeight: 1050
  };

  let editorImageToken = 0;
  let editorReady = false;


  /* ========================================
     SHARED HELPERS
  ======================================== */

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function updateStatus(message) {
    status.textContent = message;
  }

  function updateEditorStatus(message) {
    editorStatus.textContent = message;
  }


  /* ========================================
     PHOTOBOOTH CONTROLS
  ======================================== */

  function updateControls() {
    captureButton.disabled = !cameraReady || busy;
    retakeButton.disabled = busy || photos.length === 0;

    gridOptions.forEach(button => {
      button.disabled = busy;
    });

    timerOptions.forEach(button => {
      button.disabled = busy;
    });

    cancelButton.classList.toggle("hidden", !sessionActive);
    captureButton.classList.toggle("hidden", sessionActive);
    cancelButton.disabled = !sessionActive;
  }

  function updateProgress() {
    const percent = selectedCount > 0
      ? Math.round((photos.length / selectedCount) * 100)
      : 0;

    gridStatus.textContent = photos.length >= selectedCount
      ? `All ${selectedCount} photos captured!`
      : `Photo ${photos.length + 1} of ${selectedCount}`;

    progressPercent.textContent = `${percent}% complete`;
    progressBar.style.width = `${percent}%`;
  }

  function updateCaption() {
    const caption = captionInput.value.trim() ||
      "a moment to remember ♡";

    const date = new Date().toLocaleDateString();

    $("photoCaption").textContent = caption;
    $("photoDate").textContent = date;
    $("printCaption").textContent = caption;
    $("printDate").textContent = date;
  }

  function clearFinalPhoto() {
    if (photoURL) {
      URL.revokeObjectURL(photoURL);
      photoURL = null;
    }

    preview.removeAttribute("src");
    printImage.removeAttribute("src");
    previewPlaceholder.classList.remove("hidden");

    printButton.disabled = true;
    downloadButton.disabled = true;
    openEditorButton.disabled = true;

    editorState.image = null;
    editorState.imageURL = null;
    editorState.stickers = [];
    editorState.texts = [];
    editorState.selectedTextId = null;
    editorState.selectedEmoji = null;
    editorReady = false;
    editorEmpty.classList.remove("hidden");
  }

  function clearPhotos() {
    photos.forEach(photo => photo.close());
    photos = [];

    clearFinalPhoto();
    updateProgress();
  }

  function selectGrid(count) {
    if (busy) return;

    selectedCount = count;
    clearPhotos();

    gridOptions.forEach(button => {
      const selected = Number(button.dataset.count) === count;

      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    updateControls();

    updateStatus(cameraReady
      ? `${count}-photo layout selected. Ready to begin!`
      : "Choose a layout, then start your camera.");
  }

  function selectCountdown(seconds) {
    if (busy) return;

    selectedSeconds = seconds;

    timerOptions.forEach(button => {
      const selected = Number(button.dataset.seconds) === seconds;

      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    updateStatus(`Countdown set to ${seconds} seconds.`);
  }


  /* ========================================
     CAMERA
  ======================================== */

  async function startCamera() {
    if (cameraReady || busy) return;

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      updateStatus(
        "Camera access requires HTTPS or localhost. Open this page through Live Server."
      );
      return;
    }

    startButton.disabled = true;
    updateStatus("Opening camera...");

    let newStream = null;

    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 }
        }
      });

      if (disposed) {
        newStream.getTracks().forEach(track => track.stop());
        return;
      }

      stream = newStream;
      camera.srcObject = stream;

      await camera.play();

      cameraReady = true;
      placeholder.classList.add("hidden");
      startButton.textContent = "Camera Ready";

      updateControls();
      updateStatus("Choose your layout and get ready!");

    } catch (error) {
      console.error("Camera error:", error);

      if (newStream) {
        newStream.getTracks().forEach(track => track.stop());
      }

      stream = null;
      cameraReady = false;
      startButton.disabled = false;

      updateStatus(
        "Camera unavailable. Allow camera permission and use HTTPS or localhost."
      );
    }
  }

  async function capturePhoto() {
    if (!cameraReady || !camera.videoWidth || !camera.videoHeight) {
      throw new Error("The camera is not ready.");
    }

    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;

    // Mirror the saved image to match the selfie preview.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(camera, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, "image/jpeg", 0.95);
    });

    if (!blob) {
      throw new Error("Unable to create the photo.");
    }

    return createImageBitmap(blob);
  }


  /* ========================================
     COUNTDOWN AND PHOTO SESSION
  ======================================== */

  async function runCountdown(token) {
    for (let remaining = selectedSeconds; remaining > 0; remaining--) {
      if (cancelRequested || token !== sessionToken) {
        return false;
      }

      countdown.textContent = String(remaining);
      countdown.classList.remove("hidden");

      updateStatus(
        `Photo ${photos.length + 1} of ${selectedCount} — get ready!`
      );

      await wait(1000);
    }

    if (cancelRequested || token !== sessionToken) {
      return false;
    }

    countdown.textContent = "SMILE!";
    updateStatus("Say cheese!");

    await wait(250);

    if (cancelRequested || token !== sessionToken) {
      return false;
    }

    countdown.classList.add("hidden");
    return true;
  }

  function showFlash() {
    flash.classList.remove("hidden");
    flash.classList.remove("active");

    void flash.offsetWidth;
    flash.classList.add("active");
  }

  async function startPhotoSession() {
    if (!cameraReady || busy || sessionActive) return;

    if (photos.length >= selectedCount) {
      updateStatus("Press Start Over to take another set of photos.");
      return;
    }

    busy = true;
    sessionActive = true;
    cancelRequested = false;

    const token = ++sessionToken;
    updateControls();

    try {
      while (photos.length < selectedCount) {
        if (cancelRequested || token !== sessionToken) break;

        const ready = await runCountdown(token);

        if (!ready) break;

        const photo = await capturePhoto();

        if (cancelRequested || token !== sessionToken) {
          photo.close();
          break;
        }

        photos.push(photo);
        showFlash();
        updateProgress();

        if (photos.length < selectedCount) {
          updateStatus(
            `Photo ${photos.length} captured! Get ready for the next pose.`
          );

          await wait(1200);
        }
      }

      if (token !== sessionToken || cancelRequested) return;

      if (photos.length === selectedCount) {
        updateStatus("Creating your photo collage...");

        await createCollage();

        if (token === sessionToken && !cancelRequested) {
          updateStatus("All photos captured! Your print is ready.");
        }
      } else {
        updateStatus(
          `Session ended. ${photos.length} photo(s) captured.`
        );
      }

    } catch (error) {
      console.error("Photo session error:", error);
      updateStatus("Could not complete the photo session. Please try again.");

    } finally {
      if (token === sessionToken) {
        countdown.classList.add("hidden");
        busy = false;
        sessionActive = false;
        cancelRequested = false;
        updateControls();
      }
    }
  }

  function cancelPhotoSession() {
    if (!sessionActive) return;

    cancelRequested = true;
    sessionToken++;

    sessionActive = false;
    busy = false;

    countdown.classList.add("hidden");
    updateControls();

    updateStatus(
      `Session cancelled. ${photos.length} captured photo(s) retained.`
    );
  }


  /* ========================================
     CREATE PHOTO COLLAGE
  ======================================== */

  async function createCollage() {
    if (!photos.length) {
      throw new Error("No photos have been captured.");
    }

    const outputWidth = 1200;
    const outputHeight = 1400;
    const padding = 20;
    const gap = 12;

    const columns = photos.length === 1 ? 1 : 2;
    const rows = Math.ceil(photos.length / columns);

    const cellWidth =
      (outputWidth - padding * 2 - gap * (columns - 1)) / columns;

    const cellHeight =
      (outputHeight - padding * 2 - gap * (rows - 1)) / rows;

    canvas.width = outputWidth;
    canvas.height = outputHeight;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    photos.forEach((photo, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);

      const x = padding + column * (cellWidth + gap);
      const y = padding + row * (cellHeight + gap);

      const scale = Math.max(
        cellWidth / photo.width,
        cellHeight / photo.height
      );

      const sourceWidth = cellWidth / scale;
      const sourceHeight = cellHeight / scale;

      ctx.drawImage(
        photo,
        (photo.width - sourceWidth) / 2,
        (photo.height - sourceHeight) / 2,
        sourceWidth,
        sourceHeight,
        x,
        y,
        cellWidth,
        cellHeight
      );
    });

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, "image/jpeg", 0.95);
    });

    if (!blob) {
      throw new Error("Could not generate the collage.");
    }

    clearFinalPhoto();

    photoURL = URL.createObjectURL(blob);

    preview.src = photoURL;
    printImage.src = photoURL;

    previewPlaceholder.classList.add("hidden");

    updateCaption();

    printButton.disabled = false;
    downloadButton.disabled = false;
    openEditorButton.disabled = false;

    // Automatically prepare the editor's source image.
    loadEditorImage(photoURL);
  }

  function retakePhoto() {
    if (busy) return;

    clearPhotos();
    updateControls();

    updateStatus(cameraReady
      ? "Ready for another photo session!"
      : "Start the camera when you're ready.");
  }


  /* ========================================
     DOWNLOAD AND PRINT ORIGINAL PHOTO
  ======================================== */

  async function printPhoto() {
    if (!photoURL) return;

    updateCaption();

    try {
      if (typeof printImage.decode === "function") {
        await printImage.decode();
      }

      document.body.classList.remove("print-editor");
      document.body.classList.add("print-standard");

      window.print();

    } catch (error) {
      console.error("Print error:", error);
      updateStatus("Unable to prepare the print image.");
    }
  }

  function downloadPhoto() {
    if (!photoURL) return;

    downloadURL(photoURL, `nextgen-photo-${Date.now()}.jpg`);
  }

  function downloadURL(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();
  }


  /* ========================================
     PHOTO EDITOR: LOAD IMAGE
  ======================================== */

  function loadEditorImage(url) {
    const token = ++editorImageToken;

    editorState.image = null;
    editorState.imageURL = url;
    editorState.stickers = [];
    editorState.texts = [];
    editorState.selectedTextId = null;
    refreshOverlayTextList();
    syncOverlayTextControls();
    editorState.filter = "normal";
    editorState.brightness = 100;
    editorState.contrast = 100;
    editorState.saturation = 100;
    editorState.caption = captionInput.value.trim() ||
      "a moment to remember ♡";
    editorState.date = new Date().toLocaleDateString();

    const image = new Image();

    image.onload = () => {
      if (token !== editorImageToken) return;

      editorState.image = image;
      editorState.imageWidth = image.naturalWidth || image.width;
      editorState.imageHeight = image.naturalHeight || image.height;

      editorReady = true;
      editorEmpty.classList.add("hidden");

      editorCanvas.width = editorState.imageWidth;
      editorCanvas.height = editorState.imageHeight;

      syncEditorControls();
      renderEditor();

      updateEditorStatus("Your photo is ready to edit!");
    };

    image.onerror = () => {
      if (token !== editorImageToken) return;

      editorReady = false;
      editorEmpty.classList.remove("hidden");
      updateEditorStatus("Unable to load your photo. Please try again.");
    };

    image.src = url;
  }

  function initializeEditor() {
    if (!photoURL) {
      editorEmpty.classList.remove("hidden");
      editorReady = false;
      renderEditor();
      return;
    }

    if (editorState.imageURL !== photoURL || !editorState.image) {
      loadEditorImage(photoURL);
    } else {
      editorEmpty.classList.add("hidden");
      editorReady = true;
      renderEditor();
    }

    editorCaptionInput.value = editorState.caption;
  }


  /* ========================================
     FILTER DEFINITIONS
  ======================================== */

  const filterPresets = {
    normal: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      sepia: 0,
      grayscale: 0,
      hue: 0
    },

    grayscale: {
      brightness: 1,
      contrast: 1,
      saturation: 0,
      sepia: 0,
      grayscale: 1,
      hue: 0
    },

    sepia: {
      brightness: 1.05,
      contrast: 0.95,
      saturation: 0.8,
      sepia: 0.75,
      grayscale: 0,
      hue: 0
    },

    warm: {
      brightness: 1.05,
      contrast: 1.02,
      saturation: 1.15,
      sepia: 0.15,
      grayscale: 0,
      hue: -8
    },

    cool: {
      brightness: 1.02,
      contrast: 1.05,
      saturation: 1.1,
      sepia: 0,
      grayscale: 0,
      hue: 12
    },

    vivid: {
      brightness: 1.04,
      contrast: 1.15,
      saturation: 1.65,
      sepia: 0,
      grayscale: 0,
      hue: 0
    },

    soft: {
      brightness: 1.08,
      contrast: 0.88,
      saturation: 0.85,
      sepia: 0.08,
      grayscale: 0,
      hue: 0
    },

    dreamy: {
      brightness: 1.12,
      contrast: 0.92,
      saturation: 1.2,
      sepia: 0.05,
      grayscale: 0,
      hue: -12
    }
  };

  function getCanvasFilter() {
    const preset = filterPresets[editorState.filter] ||
      filterPresets.normal;

    const brightness = editorState.brightness / 100;
    const contrast = editorState.contrast / 100;
    const saturation = editorState.saturation / 100;

    return [
      `brightness(${preset.brightness * brightness})`,
      `contrast(${preset.contrast * contrast})`,
      `saturate(${preset.saturation * saturation})`,
      `sepia(${preset.sepia})`,
      `grayscale(${preset.grayscale})`,
      `hue-rotate(${preset.hue}deg)`
    ].join(" ");
  }


  /* ========================================
     PHOTO EDITOR: RENDER CANVAS
  ======================================== */

  let exportingEditor = false;

  function renderEditor() {
    if (!editorCanvas || !editorCtx) return;

    const width = editorCanvas.width;
    const height = editorCanvas.height;

    editorCtx.clearRect(0, 0, width, height);

    if (!editorState.image || !editorReady) {
      editorCtx.fillStyle = "#eaf2ff";
      editorCtx.fillRect(0, 0, width, height);
      return;
    }

    editorCtx.save();
    editorCtx.filter = getCanvasFilter();

    editorCtx.drawImage(
      editorState.image,
      0,
      0,
      width,
      height
    );

    editorCtx.restore();

    // Stickers are drawn after the photo filter.
    // Their colors remain bright and unaffected by the filter.
    editorState.stickers.forEach(sticker => {
      editorCtx.save();
      editorCtx.textAlign = "center";
      editorCtx.textBaseline = "middle";
      editorCtx.font =
        `${sticker.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

      editorCtx.fillText(
        sticker.emoji,
        sticker.x * width,
        sticker.y * height
      );

      editorCtx.restore();
    });

    // User-added text overlays are drawn into the canvas, so they are included in downloads and prints.
    editorState.texts.forEach(textItem => {
      editorCtx.save();
      editorCtx.textAlign = "center";
      editorCtx.textBaseline = "middle";
      editorCtx.font = `${textItem.style} ${textItem.size}px ${textItem.font}`;
      editorCtx.lineJoin = "round";
      // A subtle outline helps text remain readable on bright or busy photos.
      editorCtx.strokeStyle = "rgba(0,0,0,0.35)";
      editorCtx.lineWidth = Math.max(2, textItem.size * 0.055);
      editorCtx.strokeText(textItem.text, textItem.x * width, textItem.y * height);
      editorCtx.fillStyle = textItem.color;
      editorCtx.fillText(textItem.text, textItem.x * width, textItem.y * height);
      if (!exportingEditor && textItem.id === editorState.selectedTextId) {
        const measured = editorCtx.measureText(textItem.text).width;
        editorCtx.strokeStyle = "rgba(0, 190, 230, 0.95)";
        editorCtx.lineWidth = Math.max(2, width * 0.0025);
        editorCtx.setLineDash([8, 6]);
        editorCtx.strokeRect(textItem.x * width - measured / 2 - 10,
          textItem.y * height - textItem.size * 0.75,
          measured + 20, textItem.size * 1.5);
      }
      editorCtx.restore();
    });

    // Caption and date become part of the exported image.
    drawEditorCaption();
  }

  function drawEditorCaption() {
    const width = editorCanvas.width;
    const height = editorCanvas.height;

    const caption = editorState.caption.trim();

    if (!caption) return;

    const footerHeight = Math.max(80, height * 0.105);

    editorCtx.save();

    editorCtx.fillStyle = "rgba(255,255,255,0.94)";
    editorCtx.fillRect(
      0,
      height - footerHeight,
      width,
      footerHeight
    );

    editorCtx.textAlign = "center";
    editorCtx.textBaseline = "middle";

    const fontSize = Math.max(18, Math.min(34, width * 0.033));

    editorCtx.fillStyle = "#061640";
    editorCtx.font = `700 ${fontSize}px Inter, sans-serif`;

    let displayCaption = caption;
    const maxWidth = width * 0.9;

    while (
      editorCtx.measureText(displayCaption).width > maxWidth &&
      displayCaption.length > 4
    ) {
      displayCaption = displayCaption.slice(0, -2) + "…";
    }

    editorCtx.fillText(
      displayCaption,
      width / 2,
      height - footerHeight * 0.57
    );

    editorCtx.fillStyle = "#667da4";
    editorCtx.font = `${Math.max(12, fontSize * 0.48)}px Inter, sans-serif`;

    editorCtx.fillText(
      editorState.date,
      width / 2,
      height - footerHeight * 0.19
    );

    editorCtx.restore();
  }


  /* ========================================
     FILTER CONTROLS
  ======================================== */

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      editorState.filter = button.dataset.filter;

      filterButtons.forEach(option => {
        option.classList.toggle(
          "selected",
          option === button
        );
      });

      renderEditor();

      updateEditorStatus(
        `${button.querySelector("span:last-child").textContent} filter applied.`
      );
    });
  });


  /* ========================================
     BRIGHTNESS / CONTRAST / SATURATION
  ======================================== */

  function updateAdjustments() {
    editorState.brightness = Number(brightnessInput.value);
    editorState.contrast = Number(contrastInput.value);
    editorState.saturation = Number(saturationInput.value);

    $("brightnessValue").textContent =
      `${editorState.brightness}%`;

    $("contrastValue").textContent =
      `${editorState.contrast}%`;

    $("saturationValue").textContent =
      `${editorState.saturation}%`;

    renderEditor();
  }

  brightnessInput.addEventListener("input", updateAdjustments);
  contrastInput.addEventListener("input", updateAdjustments);
  saturationInput.addEventListener("input", updateAdjustments);

  $("resetAdjustments").addEventListener("click", () => {
    brightnessInput.value = 100;
    contrastInput.value = 100;
    saturationInput.value = 100;

    updateAdjustments();

    updateEditorStatus("Brightness, contrast, and saturation reset.");
  });


  /* ========================================
     EMOJI STICKERS
  ======================================== */

  stickerButtons.forEach(button => {
    button.addEventListener("click", () => {
      editorState.selectedEmoji = button.dataset.emoji;
      editorState.selectedTextId = null;
      refreshOverlayTextList();
      syncOverlayTextControls();

      stickerButtons.forEach(option => {
        option.classList.toggle(
          "selected",
          option === button
        );
      });

      updateEditorStatus(
        `${editorState.selectedEmoji} selected. Click your photo to place it.`
      );
    });
  });

  stickerSizeInput.addEventListener("input", () => {
    editorState.stickerSize = Number(stickerSizeInput.value);

    $("stickerSizeValue").textContent =
      `${editorState.stickerSize}px`;
  });

  editorCanvas.addEventListener("click", event => {
    if (!editorReady || !editorState.image) {
      updateEditorStatus("Take a photo first to add text or stickers.");
      return;
    }

    const rect = editorCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const footerLimit = 1 - Math.max(80, editorCanvas.height * 0.105) / editorCanvas.height;

    // If a text overlay is selected, clicking the image moves that text.
    const selectedText = editorState.texts.find(item => item.id === editorState.selectedTextId);
    if (selectedText) {
      if (y >= footerLimit) {
        updateEditorStatus("Place text above the caption area.");
        return;
      }
      selectedText.x = Math.max(0.05, Math.min(0.95, x));
      selectedText.y = Math.max(0.04, Math.min(footerLimit - 0.03, y));
      renderEditor();
      updateEditorStatus("Text moved. Use the controls to customize it.");
      return;
    }

    if (!editorState.selectedEmoji) {
      updateEditorStatus("Choose a sticker or add text first.");
      return;
    }
    if (y >= footerLimit) {
      updateEditorStatus("Choose a spot above the caption.");
      return;
    }

    editorState.stickers.push({
      emoji: editorState.selectedEmoji,
      x: Math.max(0.03, Math.min(0.97, x)),
      y: Math.max(0.03, Math.min(footerLimit - 0.02, y)),
      size: editorState.stickerSize
    });
    renderEditor();
    updateEditorStatus(`${editorState.selectedEmoji} sticker added!`);
  });

  $("undoSticker").addEventListener("click", () => {
    if (!editorState.stickers.length) {
      updateEditorStatus("There are no stickers to undo.");
      return;
    }

    editorState.stickers.pop();
    renderEditor();

    updateEditorStatus("Last sticker removed.");
  });

  $("clearStickers").addEventListener("click", () => {
    editorState.stickers = [];
    renderEditor();

    updateEditorStatus("All stickers removed.");
  });


  /* ========================================
     TEXT OVERLAYS
  ======================================== */

  function getSelectedOverlayText() {
    return editorState.texts.find(item => item.id === editorState.selectedTextId) || null;
  }

  function refreshOverlayTextList() {
    const currentId = editorState.selectedTextId;
    overlayTextSelect.innerHTML = '<option value="">No text selected</option>';
    editorState.texts.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = `${index + 1}. ${item.text || "(empty text)"}`;
      overlayTextSelect.appendChild(option);
    });
    overlayTextSelect.value = currentId == null ? "" : String(currentId);
  }

  function syncOverlayTextControls() {
    const item = getSelectedOverlayText();
    const hasSelection = Boolean(item);
    overlayTextSelect.value = hasSelection ? String(item.id) : "";
    overlayTextInput.value = hasSelection ? item.text : "";
    overlayFontInput.value = hasSelection ? item.font : "Arial";
    overlayFontStyleInput.value = hasSelection ? item.style : "normal";
    overlayTextColorInput.value = hasSelection ? item.color : "#ffffff";
    overlayTextSizeInput.value = hasSelection ? item.size : 48;
    overlayTextSizeValue.textContent = `${overlayTextSizeInput.value}px`;
    $("updateOverlayText").disabled = !hasSelection;
    $("deleteOverlayText").disabled = !hasSelection;
  }

  function applyOverlayTextControls() {
    const item = getSelectedOverlayText();
    if (!item) return;
    item.text = overlayTextInput.value.trim() || "Text";
    item.font = overlayFontInput.value;
    item.style = overlayFontStyleInput.value;
    item.color = overlayTextColorInput.value;
    item.size = Number(overlayTextSizeInput.value);
    refreshOverlayTextList();
    syncOverlayTextControls();
    renderEditor();
  }

  $("addOverlayText").addEventListener("click", () => {
    if (!editorReady || !editorState.image) {
      updateEditorStatus("Take a photo first before adding text.");
      return;
    }
    const text = overlayTextInput.value.trim() || "Your text";
    const id = editorState.nextTextId++;
    editorState.texts.push({
      id,
      text,
      x: 0.5,
      y: 0.4,
      font: overlayFontInput.value,
      style: overlayFontStyleInput.value,
      color: overlayTextColorInput.value,
      size: Number(overlayTextSizeInput.value)
    });
    editorState.selectedTextId = id;
    editorState.selectedEmoji = null;
    stickerButtons.forEach(button => button.classList.remove("selected"));
    refreshOverlayTextList();
    syncOverlayTextControls();
    renderEditor();
    updateEditorStatus("Text added! Click the photo to move it, or edit its style here.");
  });

  overlayTextSelect.addEventListener("change", () => {
    editorState.selectedTextId = overlayTextSelect.value ? Number(overlayTextSelect.value) : null;
    editorState.selectedEmoji = null;
    syncOverlayTextControls();
    renderEditor();
  });

  [overlayTextInput, overlayFontInput, overlayFontStyleInput, overlayTextColorInput, overlayTextSizeInput].forEach(control => {
    control.addEventListener("input", () => {
      overlayTextSizeValue.textContent = `${overlayTextSizeInput.value}px`;
      applyOverlayTextControls();
    });
    control.addEventListener("change", applyOverlayTextControls);
  });

  $("updateOverlayText").addEventListener("click", () => {
    if (!getSelectedOverlayText()) {
      updateEditorStatus("Select a text item first.");
      return;
    }
    applyOverlayTextControls();
    updateEditorStatus("Text changes applied.");
  });

  $("deleteOverlayText").addEventListener("click", () => {
    if (editorState.selectedTextId == null) return;
    editorState.texts = editorState.texts.filter(item => item.id !== editorState.selectedTextId);
    editorState.selectedTextId = null;
    refreshOverlayTextList();
    syncOverlayTextControls();
    renderEditor();
    updateEditorStatus("Text removed from the photo.");
  });

  /* ========================================
     CAPTION
  ======================================== */

  $("applyEditorCaption").addEventListener("click", () => {
    editorState.caption = editorCaptionInput.value.trim();
    renderEditor();

    updateEditorStatus("Photo caption updated.");
  });

  editorCaptionInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("applyEditorCaption").click();
    }
  });


  /* ========================================
     RESET EDITOR
  ======================================== */

  function syncEditorControls() {
    brightnessInput.value = editorState.brightness;
    contrastInput.value = editorState.contrast;
    saturationInput.value = editorState.saturation;
    stickerSizeInput.value = editorState.stickerSize;

    $("brightnessValue").textContent =
      `${editorState.brightness}%`;

    $("contrastValue").textContent =
      `${editorState.contrast}%`;

    $("saturationValue").textContent =
      `${editorState.saturation}%`;

    $("stickerSizeValue").textContent =
      `${editorState.stickerSize}px`;

    filterButtons.forEach(button => {
      button.classList.toggle(
        "selected",
        button.dataset.filter === editorState.filter
      );
    });

    stickerButtons.forEach(button => {
      button.classList.toggle(
        "selected",
        button.dataset.emoji === editorState.selectedEmoji
      );
    });

    editorCaptionInput.value = editorState.caption;
  }

  $("resetEditor").addEventListener("click", () => {
    if (!editorState.image) {
      updateEditorStatus("Take a photo first.");
      return;
    }

    editorState.filter = "normal";
    editorState.brightness = 100;
    editorState.contrast = 100;
    editorState.saturation = 100;
    editorState.stickers = [];
    editorState.texts = [];
    editorState.selectedTextId = null;
    editorState.selectedEmoji = null;
    editorState.stickerSize = 64;
    editorState.caption = "a moment to remember ♡";

    syncEditorControls();
    refreshOverlayTextList();
    syncOverlayTextControls();
    renderEditor();

    updateEditorStatus("All edits have been reset.");
  });


  /* ========================================
     EXPORT EDITED PHOTO
  ======================================== */

  function createEditedBlob() {
    return new Promise((resolve, reject) => {
      if (!editorReady || !editorState.image) {
        reject(new Error("No photo is ready to export."));
        return;
      }

      exportingEditor = true;
      renderEditor();
      exportingEditor = false;

      editorCanvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Unable to export the edited photo."));
        }
      }, "image/jpeg", 0.95);
    });
  }

  async function saveEditedPhoto() {
    try {
      const blob = await createEditedBlob();
      const url = URL.createObjectURL(blob);

      downloadURL(url, `nextgen-edited-${Date.now()}.jpg`);

      // Delay revoking the URL to allow the download to start.
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      updateEditorStatus("Your edited photo has been downloaded!");

    } catch (error) {
      console.error("Download error:", error);
      updateEditorStatus(
        "Unable to download. Take a photo first."
      );
    }
  }

  async function printEditedPhoto() {
    try {
      const blob = await createEditedBlob();
      const url = URL.createObjectURL(blob);
      const printTarget = $("editorPrintImage");

      printTarget.src = url;

      if (typeof printTarget.decode === "function") {
        await printTarget.decode();
      } else {
        await new Promise((resolve, reject) => {
          printTarget.onload = resolve;
          printTarget.onerror = reject;
        });
      }

      document.body.classList.remove("print-standard");
      document.body.classList.add("print-editor");

      window.print();

      // Keep the image URL alive until the print dialog has been used.
      window.addEventListener("afterprint", function cleanup() {
        URL.revokeObjectURL(url);
        printTarget.removeAttribute("src");
        window.removeEventListener("afterprint", cleanup);
      }, { once: true });

    } catch (error) {
      console.error("Print error:", error);
      updateEditorStatus(
        "Unable to print. Take a photo first and try again."
      );
    }
  }

  $("saveEditedPhoto").addEventListener("click", saveEditedPhoto);
  $("printEditedPhoto").addEventListener("click", printEditedPhoto);


  /* ========================================
     EVENT LISTENERS
  ======================================== */

  startButton.addEventListener("click", startCamera);
  captureButton.addEventListener("click", startPhotoSession);
  cancelButton.addEventListener("click", cancelPhotoSession);
  retakeButton.addEventListener("click", retakePhoto);
  printButton.addEventListener("click", printPhoto);
  downloadButton.addEventListener("click", downloadPhoto);

  openEditorButton.addEventListener("click", () => {
    if (!photoURL) return;

    showPage("editorPage");
  });

  gridOptions.forEach(button => {
    button.addEventListener("click", () => {
      selectGrid(Number(button.dataset.count));
    });
  });

  timerOptions.forEach(button => {
    button.addEventListener("click", () => {
      selectCountdown(Number(button.dataset.seconds));
    });
  });

  captionInput.addEventListener("input", () => {
    updateCaption();

    if (editorState.image) {
      editorState.caption = captionInput.value.trim() ||
        "a moment to remember ♡";

      editorCaptionInput.value = editorState.caption;
      renderEditor();
    }
  });

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-standard", "print-editor");

    if (cameraReady) {
      updateStatus("Print window closed. Ready for your next memory!");
    }
  });

  window.addEventListener("beforeunload", () => {
    disposed = true;
    sessionToken++;

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    if (photoURL) {
      URL.revokeObjectURL(photoURL);
    }

    photos.forEach(photo => photo.close());
  });


  /* ========================================
     INITIALIZE
  ======================================== */

  selectGrid(4);
  selectCountdown(3);
  updateCaption();
  updateControls();

  brightnessInput.value = 100;
  contrastInput.value = 100;
  saturationInput.value = 100;
  stickerSizeInput.value = 64;
  overlayTextSizeInput.value = 48;
  refreshOverlayTextList();
  syncOverlayTextControls();

  $("brightnessValue").textContent = "100%";
  $("contrastValue").textContent = "100%";
  $("saturationValue").textContent = "100%";
  $("stickerSizeValue").textContent = "64px";

  showPage("welcomePage");
});