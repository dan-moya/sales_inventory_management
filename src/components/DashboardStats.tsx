import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useSalesStore } from '../store/sales';
import SalesPDF from './SalesPDF';

export default function DashboardStats() {
	const [showAmounts, setShowAmounts] = useState(true);
	const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'yesterday' | 'month' | 'total' | null>(null);
	const {
		todaySales,
		yesterdaySales,
		monthSales,
		totalSales,
		todaySalesList,
		yesterdaySalesList,
		monthSalesList,
		allSales,
	} = useSalesStore();

	const formatAmount = (amount: number) => {
		if (!showAmounts) return '****';
		return `Bs. ${amount.toFixed(2)}`;
	};

	const getPeriodSales = () => {
		switch (selectedPeriod) {
			case 'today':
				return { title: 'VENTAS DE HOY', sales: todaySalesList };
			case 'yesterday':
				return { title: 'VENTAS DE AYER', sales: yesterdaySalesList };
			case 'month':
				return { title: 'VENTAS DE ESTE MES', sales: monthSalesList };
			case 'total':
				return { title: 'VENTA TOTAL', sales: allSales };
			default:
				return null;
		}
	};

	return (
		<>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4">
				<div
					className="bg-pink-200 p-4 rounded-lg shadow hover:bg-pink-300 transition-colors cursor-pointer"
					onClick={() => setSelectedPeriod('today')}
				>
					<div className="flex justify-between items-center">
						<h3 className="text-lg font-semibold">Hoy</h3>
						<div
							onClick={(e) => {
								e.stopPropagation();
								setShowAmounts(!showAmounts);
							}}
							className="text-gray-600 hover:text-gray-800 cursor-pointer"
						>
							{showAmounts ? <EyeOff size={20} /> : <Eye size={20} />}
						</div>
					</div>
					<p className="text-2xl font-bold mt-2">{formatAmount(todaySales)}</p>
				</div>

				<div
					className="bg-yellow-200 p-4 rounded-lg shadow hover:bg-yellow-300 transition-colors cursor-pointer"
					onClick={() => setSelectedPeriod('yesterday')}
				>
					<h3 className="text-lg font-semibold">Ayer</h3>
					<p className="text-2xl font-bold mt-2">{formatAmount(yesterdaySales)}</p>
				</div>

				<div
					className="bg-orange-200 p-4 rounded-lg shadow hover:bg-orange-300 transition-colors cursor-pointer"
					onClick={() => setSelectedPeriod('month')}
				>
					<h3 className="text-lg font-semibold">Este mes</h3>
					<p className="text-2xl font-bold mt-2">{formatAmount(monthSales)}</p>
				</div>

				<div
					className="bg-green-200 p-4 rounded-lg shadow hover:bg-green-300 transition-colors cursor-pointer"
					onClick={() => setSelectedPeriod('total')}
				>
					<h3 className="text-lg font-semibold">Venta Total</h3>
					<p className="text-2xl font-bold mt-2">{formatAmount(totalSales)}</p>
				</div>
			</div>

			{selectedPeriod && getPeriodSales() && (
				<SalesPDF
					title={getPeriodSales()!.title}
					sales={getPeriodSales()!.sales}
					onClose={() => setSelectedPeriod(null)}
				/>
			)}
		</>
	);
}
