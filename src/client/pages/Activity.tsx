export default function Activity() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Activity Log</h2>
      <div className="rounded-xl border border-gray-800 bg-gray-900">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="px-6 py-3 font-medium">Time</th>
              <th className="px-6 py-3 font-medium">Action</th>
              <th className="px-6 py-3 font-medium">Instance</th>
              <th className="px-6 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                No activity recorded yet. Actions taken by Filtarr will appear here.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

