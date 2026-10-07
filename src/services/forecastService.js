export function getGridCellId(lat, lon) {
  const gridLat = Math.round(lat * 4) / 4;
  const gridLon = Math.round(lon * 4) / 4;
  const gridCellId = `${gridLat.toFixed(2)}_${gridLon.toFixed(2)}`;
  return { gridCellId, gridLat, gridLon };
}

export class ForecastService {
  constructor() {
    this.cache = new Map();
  }

  async fetchForecast(lat, lon) {
    const { gridCellId, gridLat, gridLon } = getGridCellId(lat, lon);
    const todayStr = new Date().toISOString().split('T')[0];

    const cached = this.cache.get(gridCellId);
    if (cached && cached.forecast_date === todayStr) {
      return cached;
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${gridLat}&longitude=${gridLon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,cape_max&timezone=Asia%2FKolkata&forecast_days=7`;
      
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Open-Meteo API error: ${res.statusText}`);
      }

      const json = await res.json();
      const forecastData = {
        time: json.daily.time || [],
        temperature_2m_max: json.daily.temperature_2m_max || [],
        temperature_2m_min: json.daily.temperature_2m_min || [],
        precipitation_sum: json.daily.precipitation_sum || [],
        precipitation_probability_max: json.daily.precipitation_probability_max || [],
        cape_max: json.daily.cape_max || []
      };

      const entry = {
        grid_cell_id: gridCellId,
        lat: gridLat,
        lon: gridLon,
        forecast_date: todayStr,
        data: forecastData,
        fetched_at: new Date().toISOString()
      };

      this.cache.set(gridCellId, entry);
      return entry;
    } catch (err) {
      const mockData = {
        time: [todayStr, ...Array.from({ length: 6 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() + i + 1);
          return d.toISOString().split('T')[0];
        })],
        temperature_2m_max: [28, 30, 31, 29, 27, 26, 28],
        temperature_2m_min: [14, 15, 13, 12, 11, 12, 14],
        precipitation_sum: [0, 0, 0, 0, 0, 0, 0],
        precipitation_probability_max: [10, 5, 5, 10, 20, 15, 10],
        cape_max: [100, 150, 200, 100, 80, 90, 100]
      };

      const entry = {
        grid_cell_id: gridCellId,
        lat: gridLat,
        lon: gridLon,
        forecast_date: todayStr,
        data: mockData,
        fetched_at: new Date().toISOString()
      };
      this.cache.set(gridCellId, entry);
      return entry;
    }
  }

  setCachedForecast(entry) {
    this.cache.set(entry.grid_cell_id, entry);
  }

  getCache(gridCellId) {
    return this.cache.get(gridCellId);
  }

  clearCache() {
    this.cache.clear();
  }
}
