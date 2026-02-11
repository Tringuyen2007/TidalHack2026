'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

type Point = {
  corrected_distance_ft: number;
  clock_decimal?: number | null;
  confidence_score: number;
};

export function UnwrappedPipeView({ points }: { points: Point[] }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const width = 980;
    const height = 260;
    const margin = { top: 20, right: 20, bottom: 40, left: 50 };

    const svg = d3.select(ref.current);
    svg.selectAll('*').remove();

    const x = d3
      .scaleLinear()
      .domain(d3.extent(points, (d) => d.corrected_distance_ft) as [number, number])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear().domain([0, 12]).range([height - margin.bottom, margin.top]);

    const color = d3.scaleLinear<string>().domain([0, 50, 100]).range(['#dc2626', '#f59e0b', '#16a34a']);

    svg
      .append('g')
      .attr('transform', `translate(0, ${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(8));

    svg
      .append('g')
      .attr('transform', `translate(${margin.left}, 0)`)
      .call(d3.axisLeft(y).ticks(12));

    svg
      .append('g')
      .selectAll('circle')
      .data(points)
      .join('circle')
      .attr('cx', (d) => x(d.corrected_distance_ft))
      .attr('cy', (d) => y(d.clock_decimal ?? 0))
      .attr('r', 3)
      .attr('fill', (d) => color(d.confidence_score));
  }, [points]);

  return (
    <div className="overflow-x-auto rounded border bg-white p-3">
      <svg ref={ref} width={980} height={260} />
    </div>
  );
}
