import React from 'react';
import { Link } from 'react-router-dom';
import layoutStyles from './AdminLayout.module.css';

const AdminBreadcrumb = ({ items }) => (
  <nav className={layoutStyles.breadcrumb} aria-label="Admin breadcrumb">
    {items.map((item, index) => {
      const isLast = index === items.length - 1;
      return (
        <React.Fragment key={`${item.label}-${index}`}>
          {index > 0 && <span className={layoutStyles.breadcrumbSeparator}>/</span>}
          {item.to && !isLast ? (
            <Link className={layoutStyles.breadcrumbLink} to={item.to}>
              {item.label}
            </Link>
          ) : (
            <span className={layoutStyles.breadcrumbCurrent}>{item.label}</span>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);

export default AdminBreadcrumb;
