import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import TrafficSensorMap from './TrafficSensorMap';
import { getAdminFloorPath } from '../admin/routing/AdminRouteUtils';

export default function CampusMap({ embedded = false, focusedSensorId, focusRequest }) {
  const navigate = useNavigate();
  const { collegeId, floorId } = useParams();
  const selectSensor = useCallback((sensor) => {
    navigate(getAdminFloorPath(sensor.institute_id, sensor.sensor_id));
  }, [navigate]);
  return <TrafficSensorMap embedded={embedded} instituteId={collegeId}
    sensorId={focusedSensorId || floorId} focusRequest={focusRequest} onSensorClick={selectSensor} />;
}
