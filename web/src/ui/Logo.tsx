/** The ClassHub app icon (the same drawing as the Android launcher icon and the invite page). */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 108 108" width={size} height={size} aria-hidden style={{ borderRadius: size * 0.28, flex: 'none' }}>
      <rect width="108" height="108" fill="#0f766e" />
      <path
        fill="#fff"
        d="M37,32h9a5,5 0 0,1 5,5v9a5,5 0 0,1 -5,5h-9a5,5 0 0,1 -5,-5v-9a5,5 0 0,1 5,-5z M62,32h9a5,5 0 0,1 5,5v9a5,5 0 0,1 -5,5h-9a5,5 0 0,1 -5,-5v-9a5,5 0 0,1 5,-5z M37,57h9a5,5 0 0,1 5,5v9a5,5 0 0,1 -5,5h-9a5,5 0 0,1 -5,-5v-9a5,5 0 0,1 5,-5z"
      />
      <circle cx="66.5" cy="66.5" r="9.5" fill="#99f6e4" />
    </svg>
  );
}
