export default function StarRating({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-700">
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-amber-400">
        <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
      </svg>
      {value.toFixed(1)}
    </span>
  )
}
