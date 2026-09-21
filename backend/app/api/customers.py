from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_permission
from app.models.customer import Customer, CustomerAddress, CustomerContact
from app.models.user import User
from app.permissions import Permissions
from app.models.sales_order import SalesOrder
from app.schemas.customer import (
    CustomerAddressCreate,
    CustomerAddressResponse,
    CustomerContactCreate,
    CustomerContactResponse,
    CustomerCreate,
    CustomerListResponse,
    CustomerResponse,
    CustomerUpdate,
)
from app.schemas.sales_order import SalesOrderListResponse, SalesOrderResponse
from app.services.audit import AuditService
from app.api.notifications import create_notification

router = APIRouter(prefix="/api/customers", tags=["customers"])


async def _get_customer_for_user(customer_id: int, db: AsyncSession, current_user: User) -> Customer:
    query = select(Customer).where(Customer.id == customer_id)
    if current_user.role == "OUTSIDE_SALES":
        query = query.where(Customer.salesman_id == current_user.id)
    result = await db.execute(query)
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return customer


@router.get("/all", response_model=CustomerListResponse)
@router.get("", response_model=CustomerListResponse)
async def list_customers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    is_active: bool = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_VIEW)),
):
    query = select(Customer).options(selectinload(Customer.salesman))

    if current_user.role == "OUTSIDE_SALES":
        query = query.where(Customer.salesman_id == current_user.id)

    if search:
        query = query.where(
            or_(
                Customer.name.ilike(f"%{search}%"),
                Customer.code.ilike(f"%{search}%"),
                Customer.phone.ilike(f"%{search}%"),
                Customer.obm_customer_code.ilike(f"%{search}%"),
            )
        )
    if is_active is not None:
        query = query.where(Customer.is_active == is_active)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    customers = result.scalars().all()

    return CustomerListResponse(
        items=[CustomerResponse.model_validate(c) for c in customers],
        total=total,
        page=page,
        page_size=page_size,
        pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
    )


@router.get("/{customer_id}/contacts", response_model=list[CustomerContactResponse])
async def list_customer_contacts(
    customer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_VIEW)),
):
    await _get_customer_for_user(customer_id, db, current_user)
    result = await db.execute(
        select(CustomerContact)
        .where(CustomerContact.customer_id == customer_id, CustomerContact.is_active == True)
        .order_by(CustomerContact.is_primary.desc(), CustomerContact.name)
    )
    return result.scalars().all()


@router.post("/{customer_id}/contacts", response_model=CustomerContactResponse, status_code=status.HTTP_201_CREATED)
async def create_customer_contact(
    customer_id: int,
    body: CustomerContactCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    await _get_customer_for_user(customer_id, db, current_user)
    if body.is_primary:
        await db.execute(
            update(CustomerContact)
            .where(CustomerContact.customer_id == customer_id)
            .values(is_primary=False)
        )
    contact = CustomerContact(customer_id=customer_id, **body.model_dump())
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.delete("/{customer_id}/contacts/{contact_id}")
async def archive_customer_contact(
    customer_id: int,
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    await _get_customer_for_user(customer_id, db, current_user)
    result = await db.execute(
        select(CustomerContact).where(
            CustomerContact.id == contact_id,
            CustomerContact.customer_id == customer_id,
            CustomerContact.is_active == True,
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact.is_active = False
    if contact.is_primary:
        replacement = await db.execute(
            select(CustomerContact)
            .where(CustomerContact.customer_id == customer_id, CustomerContact.id != contact_id, CustomerContact.is_active == True)
            .order_by(CustomerContact.id)
            .limit(1)
        )
        next_contact = replacement.scalar_one_or_none()
        if next_contact:
            next_contact.is_primary = True
    await db.commit()
    return {"message": "Contact archived"}


@router.get("/{customer_id}/addresses", response_model=list[CustomerAddressResponse])
async def list_customer_addresses(
    customer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_VIEW)),
):
    await _get_customer_for_user(customer_id, db, current_user)
    result = await db.execute(
        select(CustomerAddress)
        .where(CustomerAddress.customer_id == customer_id, CustomerAddress.is_active == True)
        .order_by(CustomerAddress.is_default.desc(), CustomerAddress.label)
    )
    return result.scalars().all()


@router.post("/{customer_id}/addresses", response_model=CustomerAddressResponse, status_code=status.HTTP_201_CREATED)
async def create_customer_address(
    customer_id: int,
    body: CustomerAddressCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    await _get_customer_for_user(customer_id, db, current_user)
    if body.is_default:
        await db.execute(
            update(CustomerAddress)
            .where(CustomerAddress.customer_id == customer_id)
            .values(is_default=False)
        )
    address = CustomerAddress(customer_id=customer_id, **body.model_dump())
    db.add(address)
    await db.commit()
    await db.refresh(address)
    return address


@router.delete("/{customer_id}/addresses/{address_id}")
async def archive_customer_address(
    customer_id: int,
    address_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    await _get_customer_for_user(customer_id, db, current_user)
    result = await db.execute(
        select(CustomerAddress).where(
            CustomerAddress.id == address_id,
            CustomerAddress.customer_id == customer_id,
            CustomerAddress.is_active == True,
        )
    )
    address = result.scalar_one_or_none()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    address.is_active = False
    if address.is_default:
        replacement = await db.execute(
            select(CustomerAddress)
            .where(CustomerAddress.customer_id == customer_id, CustomerAddress.id != address_id, CustomerAddress.is_active == True)
            .order_by(CustomerAddress.id)
            .limit(1)
        )
        next_address = replacement.scalar_one_or_none()
        if next_address:
            next_address.is_default = True
    await db.commit()
    return {"message": "Address archived"}


@router.get("/{customer_id}/orders", response_model=SalesOrderListResponse)
async def get_customer_orders(
    customer_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_VIEW)),
):
    customer = await _get_customer_for_user(customer_id, db, current_user)

    query = select(SalesOrder).options(
        selectinload(SalesOrder.items),
        selectinload(SalesOrder.salesman),
        selectinload(SalesOrder.customer),
    ).where(SalesOrder.customer_id == customer_id)
    if status:
        query = query.where(SalesOrder.status == status)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.order_by(SalesOrder.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    orders = result.scalars().all()

    return SalesOrderListResponse(
        items=[SalesOrderResponse.model_validate(o) for o in orders],
        total=total,
        page=page,
        page_size=page_size,
        pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
    )


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: CustomerCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    if body.code:
        existing = await db.execute(
            select(Customer).where(Customer.code == body.code)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Customer with this code already exists",
            )

    customer = Customer(
        **body.model_dump(),
        created_by=current_user.id,
        salesman_id=current_user.id if current_user.role == "OUTSIDE_SALES" else None,
    )
    db.add(customer)
    await db.flush()

    await AuditService.log(
        db=db,
        action="customers.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="customer",
        entity_id=customer.id,
        entity_label=customer.name,
        new_values=body.model_dump(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(customer)
    return CustomerResponse.model_validate(customer)


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_VIEW)),
):
    customer = await _get_customer_for_user(customer_id, db, current_user)
    return CustomerResponse.model_validate(customer)


class AssignSalesmanRequest(BaseModel):
    salesman_id: int | None = None


@router.patch("/{customer_id}/assign-salesman", response_model=CustomerResponse)
async def assign_salesman(
    customer_id: int,
    body: AssignSalesmanRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_ASSIGN)),
):
    result = await db.execute(
        select(Customer).options(selectinload(Customer.salesman)).where(Customer.id == customer_id)
    )
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    old_salesman_id = customer.salesman_id
    new_salesman = None
    if body.salesman_id is not None:
        user_result = await db.execute(select(User).where(User.id == body.salesman_id))
        new_salesman = user_result.scalar_one_or_none()
        if not new_salesman:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salesman not found")
        if new_salesman.role != "OUTSIDE_SALES":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected user is not an outside sales representative")
        if not new_salesman.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected user is inactive")

    customer.salesman_id = new_salesman.id if new_salesman else None

    await AuditService.log(
        db=db,
        action="customers.assign_salesman",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="customer",
        entity_id=customer.id,
        entity_label=customer.name,
        old_values={"salesman_id": old_salesman_id},
        new_values={"salesman_id": customer.salesman_id},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    if new_salesman is not None:
        await create_notification(
            db,
            new_salesman.id,
            "customer.assigned",
            "New Customer Assigned",
            f"{current_user.full_name} assigned customer {customer.name} to you",
            f"/app/sales/customers",
        )

    await db.commit()
    await db.refresh(customer)
    await db.refresh(customer, ["salesman"])
    return CustomerResponse.model_validate(customer)


@router.patch("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    customer = await _get_customer_for_user(customer_id, db, current_user)

    old_values = {k: getattr(customer, k) for k in body.model_fields if getattr(customer, k, None) is not None}

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(customer, field, value)

    await AuditService.log(
        db=db,
        action="customers.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="customer",
        entity_id=customer.id,
        entity_label=customer.name,
        old_values=old_values,
        new_values=update_data,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(customer)
    return CustomerResponse.model_validate(customer)


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    await AuditService.log(
        db=db,
        action="customers.delete",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="customer",
        entity_id=customer.id,
        entity_label=customer.name,
        old_values={"name": customer.name, "code": customer.code},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.delete(customer)
    await db.commit()
    return {"message": "Customer deleted"}
