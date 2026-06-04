"use client";

interface Props { fileUrl: string }

export function ImageRenderer({ fileUrl }: Props) {
  return (
    <div className="shadow-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fileUrl}
        alt="Drawing"
        className="block max-w-none rounded bg-white"
        draggable={false}
        style={{ userSelect: "none" }}
      />
    </div>
  );
}
