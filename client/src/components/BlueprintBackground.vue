<script setup lang="ts">
defineProps<{ isDark?: boolean }>();
</script>

<template>
  <div class="bp" :class="{ 'bp--light': !isDark }" aria-hidden="true">
    <div class="bp__gradient" />


    <!-- Schematic lines + nodes -->
    <svg class="bp__schematic" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <line x1="75%" y1="8%"  x2="100%" y2="8%"  class="bp__line bp__line--accent" />
      <line x1="85%" y1="8%"  x2="82%"  y2="12%" class="bp__line bp__line--accent" />
      <line x1="82%" y1="12%" x2="95%"  y2="12%" class="bp__line bp__line--accent" />
      <line x1="0"   y1="25%" x2="8%"   y2="25%" class="bp__line bp__line--secondary" />
      <line x1="5%"  y1="25%" x2="8%"   y2="20%" class="bp__line bp__line--secondary" />
      <line x1="0"   y1="85%" x2="15%"  y2="85%" class="bp__line bp__line--secondary" />
      <line x1="10%" y1="85%" x2="12%"  y2="90%" class="bp__line bp__line--secondary" />
      <line x1="12%" y1="90%" x2="20%"  y2="90%" class="bp__line bp__line--secondary" />
      <line x1="90%" y1="70%" x2="100%" y2="70%" class="bp__line bp__line--accent" />
      <line x1="92%" y1="70%" x2="90%"  y2="75%" class="bp__line bp__line--accent" />
      <circle cx="82%" cy="12%" r="3" class="bp__node bp__node--accent" />
      <circle cx="8%"  cy="20%" r="3" class="bp__node bp__node--secondary" />
      <circle cx="12%" cy="90%" r="3" class="bp__node bp__node--secondary" />
      <circle cx="90%" cy="75%" r="3" class="bp__node bp__node--accent" />
    </svg>

    <!-- Tech labels -->
    <div class="bp__labels">
      <span class="bp__label"          style="top:5%;right:5%">SYS.EXTEND.v2.4</span>
      <span class="bp__label"          style="top:22%;left:3%">NODE.ACTIVE</span>
      <span class="bp__label"          style="bottom:12%;right:8%">CONN.SECURE</span>
      <span class="bp__label"          style="bottom:5%;left:5%">LP.PLATFORM.HUB</span>
      <span class="bp__label bp__label--dim" style="top:40%;right:2%">0x7F3A</span>
      <span class="bp__label bp__label--dim" style="bottom:35%;left:2%">0xE849</span>
    </div>

    <!-- Glow orbs (dark only) -->
    <template v-if="isDark">
      <div class="bp__orb bp__orb--pink"                style="top:15%;left:10%" />
      <div class="bp__orb bp__orb--cyan"                style="top:30%;right:15%" />
      <div class="bp__orb bp__orb--purple"              style="bottom:20%;left:20%" />
      <div class="bp__orb bp__orb--pink  bp__orb--sm"   style="bottom:35%;right:8%" />
      <div class="bp__orb bp__orb--cyan  bp__orb--sm"   style="top:60%;left:5%" />
    </template>
  </div>
</template>

<style scoped>
.bp {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: transparent;
}

/* ── Dark gradient ── */
.bp__gradient {
  position: absolute; inset: 0;
  /* Extend brand backdrop image with a slate overlay on top so panels/text stay
     readable (the overlay gradient sits ABOVE the image in the layer order). */
  background:
    linear-gradient(180deg, rgba(21,24,30,0.62) 0%, rgba(26,29,36,0.68) 40%, rgba(22,25,31,0.74) 100%),
    url('https://storage.googleapis.com/extend-platform/content/extend-bg-01.png');
  background-size: cover, cover;
  background-position: center, center;
  background-repeat: no-repeat, no-repeat;
  background-attachment: fixed, fixed;
}

.bp__grid { position: absolute; inset: 0; width: 100%; height: 100%; }
.bp__grid-small { stroke: rgba(232,73,183,0.03); }
.bp__grid-large { stroke: rgba(232,73,183,0.06); }

.bp__schematic { position: absolute; inset: 0; width: 100%; height: 100%; }
.bp__line { stroke-width: 1; }
.bp__line--accent    { stroke: rgba(139,92,246,0.18); }
.bp__line--secondary { stroke: rgba(255,255,255,0.07); }
.bp__node--accent    { fill: rgba(139,92,246,0.45); }
.bp__node--secondary { fill: rgba(255,255,255,0.22); }

.bp__labels { position: absolute; inset: 0; }
.bp__label {
  position: absolute;
  font-family: 'Fira Code', 'Monaco', monospace;
  font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase;
  color: rgba(167,139,250,0.30); white-space: nowrap;
}
.bp__label--dim { color: rgba(255,255,255,0.14); font-size: 8px; }

/* Orbs — subtle purple only (no pink/cyan in the slate theme) */
.bp__orb {
  position: absolute; width: 200px; height: 200px; border-radius: 50%;
  filter: blur(90px); opacity: 0.16;
  animation: bp-orb-pulse 8s ease-in-out infinite;
}
.bp__orb--sm { width: 120px; height: 120px; filter: blur(60px); opacity: 0.12; }
.bp__orb--pink   { background: #8b5cf6; animation-delay: 0s; }
.bp__orb--cyan   { background: #6d28d9; animation-delay: 2s; }
.bp__orb--purple { background: #8b5cf6; animation-delay: 4s; }

@keyframes bp-orb-pulse {
  0%, 100% { transform: scale(1);   opacity: 0.25; }
  50%      { transform: scale(1.1); opacity: 0.30; }
}

/* ── Light mode ── */
.bp--light { background: #e8eaf2; }
.bp--light .bp__gradient {
  background:
    radial-gradient(ellipse at 20% 80%, rgba(124,58,237,0.07) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(192,38,211,0.05) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.04) 0%, transparent 60%),
    linear-gradient(180deg, #dfe1ee 0%, #e8eaf2 30%, #e8eaf2 70%, #e2e4f0 100%);
}
.bp--light .bp__grid-small { stroke: rgba(100,80,160,0.07); }
.bp--light .bp__grid-large { stroke: rgba(100,80,160,0.12); }
.bp--light .bp__line--accent    { stroke: rgba(124,58,237,0.18); }
.bp--light .bp__line--secondary { stroke: rgba(192,38,211,0.14); }
.bp--light .bp__node--accent    { fill: rgba(124,58,237,0.35); }
.bp--light .bp__node--secondary { fill: rgba(192,38,211,0.28); }
.bp--light .bp__label     { color: rgba(100,80,160,0.28); }
.bp--light .bp__label--dim { color: rgba(124,58,237,0.20); }
</style>
