/**
  * Calculate Haversine distance in kilometers between two GPS coordinates
  */
export function calculateHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if plot (lat, lon) falls within event radius (center_lat, center_lon, radius_km)
 */
export function isPlotWithinEventArea(plotLat, plotLon, eventCenterLat, eventCenterLon, radiusKm) {
  const distKm = calculateHaversineDistanceKm(plotLat, plotLon, eventCenterLat, eventCenterLon);
  return distKm <= radiusKm;
}
