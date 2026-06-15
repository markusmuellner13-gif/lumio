export function LumioMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="lumio-gradient inline-flex items-center justify-center rounded-[28%] text-white shadow-sm"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* A four-point spark — the Lumio "light" mark */}
        <path
          d="M12 1.5c.5 4.8 2.2 6.5 7 7-4.8.5-6.5 2.2-7 7-.5-4.8-2.2-6.5-7-7 4.8-.5 6.5-2.2 7-7z"
          fill="currentColor"
        />
        <circle cx="19.5" cy="4.5" r="1.6" fill="currentColor" opacity="0.9" />
      </svg>
    </span>
  );
}
