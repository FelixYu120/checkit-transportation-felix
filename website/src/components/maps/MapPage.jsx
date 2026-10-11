import TrafficSensorMap from './TrafficSensorMap';

export default function MapPage({ onBuildingClick }) {
  return <TrafficSensorMap embedded onSensorClick={onBuildingClick} />;
}
